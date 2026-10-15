export function normalizeSearch(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function distance(a, b) {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] !== b[j - 1]));
        row = next;
    }
    return row[b.length];
}

export function matchesProduct(item, query) {
    const text = normalizeSearch([item.name, item.category, item.code].join(' '));
    const words = text.split(/\s+/);
    return normalizeSearch(query).replace(/^#/, '').split(/\s+/).every(token => {
        if (text.includes(token)) return true;
        if (token.length < 4 || /^\d+$/.test(token)) return false;
        const tolerance = token.length >= 7 ? 2 : 1;
        return words.some(word => Math.abs(word.length - token.length) <= tolerance && distance(token, word) <= tolerance);
    });
}

export function validProductPhoto(photo) {
    return photo === '' || (typeof photo === 'string' && photo.length <= 45000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(photo));
}

export async function compressProductPhoto(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Selecciona una foto JPG, PNG o WebP.');
    if (file.size > 20 * 1024 * 1024) throw new Error('La foto debe pesar menos de 20 MB.');
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('No se pudo leer la foto.'));
            image.src = url;
        });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Este navegador no puede procesar fotos.');
        for (const size of [800, 640, 480, 320]) {
            const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            for (const quality of [0.8, 0.65, 0.5, 0.35]) {
                const result = canvas.toDataURL('image/jpeg', quality);
                if (validProductPhoto(result)) return result;
            }
        }
        throw new Error('No se pudo reducir la foto. Prueba con otra imagen.');
    } finally { URL.revokeObjectURL(url); }
}
