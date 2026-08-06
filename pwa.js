let refreshing = false;
export async function registerPwa() {
    if (!('serviceWorker' in navigator))
        return;
    try {
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
        window.setInterval(() => void registration.update(), 30 * 60 * 1000);
        if (registration.waiting)
            window.dispatchEvent(new CustomEvent('colosse-update'));
        registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker)
                return;
            worker.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    window.dispatchEvent(new CustomEvent('colosse-update'));
                }
            });
        });
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing)
                return;
            refreshing = true;
            window.location.reload();
        });
        void registration.update();
    }
    catch (error) {
        console.warn('Service worker registration failed:', error);
    }
}
void registerPwa();
//# sourceMappingURL=pwa.js.map
