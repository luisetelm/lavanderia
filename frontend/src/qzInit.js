// frontend/src/qzInit.js

function waitForQZ(timeout = 3000) {
    return new Promise((resolve, reject) => {
        const interval = 50;
        let elapsed = 0;
        const check = () => {
            if (window.qz) return resolve();
            elapsed += interval;
            if (elapsed >= timeout) return reject(new Error('QZ Tray no se cargó en el tiempo esperado'));
            setTimeout(check, interval);
        };
        check();
    });
}

export async function connectQZ(retries = 3, delay = 500) {
    if (typeof window === 'undefined') throw new Error('No hay window');
    await waitForQZ(); // espera a que el script haya enlazado window.qz

    qz.api.setPromiseType((promise) => promise);

    for (let i = 0; i <= retries; i++) {
        try {
            if (!qz.websocket.isActive()) {
                await qz.websocket.connect();
            }
            return; // conectado
        } catch (err) {
            if (i === retries) throw err;
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}
