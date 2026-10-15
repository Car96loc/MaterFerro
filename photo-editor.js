import Cropper from './vendor/cropper.esm.js';
import { validProductPhoto } from './product-tools.js?v=gallery-1';

let cropper = null;
let generation = 0;

export function productPhotos(item) {
    return Array.isArray(item.photos) ? item.photos : item.photo ? [item.photo] : [];
}

export function disposeCropper() {
    generation++;
    cropper?.destroy();
    cropper = null;
}

export async function mountCropper(element, source, ready) {
    disposeCropper();
    const request = generation;
    const file = typeof source !== 'string';
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(source.type) || source.size > 20 * 1024 * 1024)) throw new Error('Selecciona JPG, PNG o WebP de menos de 20 MB.');
    const url = file ? URL.createObjectURL(source) : source;
    try {
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('No se pudo leer la foto.'));
            image.src = url;
        });
        if (request !== generation) return;
        // Bound decoded dimensions before the touch editor, especially on mobile.
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        element.src = canvas.toDataURL('image/jpeg', 0.92);
        cropper = new Cropper(element, {
            aspectRatio: 4 / 3, viewMode: 0, dragMode: 'move', autoCropArea: 0.9,
            cropBoxMovable: false, cropBoxResizable: false, toggleDragModeOnDblclick: false,
            zoomOnTouch: true, zoomOnWheel: true, background: false,
            ready() { if (request === generation) ready(); }
        });
    } finally { if (file) URL.revokeObjectURL(url); }
}

export function cropAction(action) {
    if (!cropper) return;
    if (action === 'in') cropper.zoom(0.1);
    if (action === 'out') cropper.zoom(-0.1);
    if (action === 'rotate') cropper.rotate(90);
    if (action === 'reset') cropper.reset();
}

export function exportCrop() {
    if (!cropper) throw new Error('Espera a que cargue la foto.');
    for (const width of [800, 640, 480, 320]) {
        const canvas = cropper.getCroppedCanvas({ width, height: width * 3 / 4, fillColor: '#ffffff', imageSmoothingQuality: 'high' });
        if (!canvas) throw new Error('No se pudo recortar la foto.');
        for (const quality of [0.8, 0.65, 0.5, 0.35]) {
            const result = canvas.toDataURL('image/jpeg', quality);
            if (validProductPhoto(result)) return result;
        }
    }
    throw new Error('No se pudo reducir la foto. Prueba otro encuadre.');
}
