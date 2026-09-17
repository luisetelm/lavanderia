import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { fetchEffectivePrices } from '../api.js';

export const DraftOrderContext = createContext(null);

const STORAGE_KEY = 'draftOrder';
const STORAGE_VERSION = 3; // Incrementar si cambia la estructura

const defaultState = {
    cart: [],              // [{ productId, quantity, name, basePrice, bigClientPrice }]
    selectedUser: null,    // { id, firstName, lastName, phone, email, isbigclient, discount, notifyChannel }
    clientPrices: {},      // precios pactados vigentes del cliente: { [productId]: { id, price, validTo, note } }
    clientPricesFor: null, // id del cliente al que pertenecen, para no aplicar los de otro
    quickClient: { firstName: '', lastName: '', phone: '', email: '' },
    fechaLimite: null,
    observaciones: '',
    sinSuplemento: false,  // administración exime el suplemento de urgencia de este pedido
};

function loadFromStorage() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);

        // Si la versión no coincide, descartar datos legacy
        if (parsed._v !== STORAGE_VERSION) {
            sessionStorage.removeItem(STORAGE_KEY);
            return null;
        }

        // Si no tiene cart como array, descartar
        if (!Array.isArray(parsed.cart)) {
            sessionStorage.removeItem(STORAGE_KEY);
            return null;
        }

        const qc = parsed.quickClient
            ? { ...defaultState.quickClient, ...parsed.quickClient }
            : { ...defaultState.quickClient };

        const result = { ...defaultState, ...parsed };
        result.cart = parsed.cart.map((c, i) => ({
            ...c,
            lineId: c.lineId || `${c.productId}_restored_${i}`,
            notes: c.notes || '',
            photos: c.photos || [],
            optionalStepIds: c.optionalStepIds || [],
        }));
        result.quickClient = qc;
        return result;
    } catch {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
    }
}

export function DraftOrderProvider({ children, token }) {
    const [state, setState] = useState(() => loadFromStorage() || { ...defaultState, quickClient: { ...defaultState.quickClient } });
    const [bannerHeight, setBannerHeight] = useState(0);
    // Lo que el calendario de entregas sabe hoy: fecha sugerida y % de suplemento
    // por adelantarla. No se persiste: lo vuelve a mandar el servidor al cargar.
    const [calendarInfo, setCalendarInfo] = useState({ suggestedDate: null, urgencyPct: 0 });

    // Persistir en sessionStorage (excluyendo fotos dataUrl — demasiado grandes)
    useEffect(() => {
        const hasData = (state.cart || []).length > 0 || state.selectedUser || state.quickClient?.firstName;
        if (hasData) {
            const stripped = {
                ...state,
                cart: state.cart.map(c => ({ ...c, photos: [], availableOptionalSteps: undefined })),
                _v: STORAGE_VERSION,
            };
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
        } else {
            sessionStorage.removeItem(STORAGE_KEY);
        }
    }, [state]);

    /* ── Acciones del carrito ── */

    const addToCart = useCallback((product) => {
        // Determinar pasos opcionales del itinerario del producto
        const optionalSteps = product.itinerary?.steps?.filter(s => s.isOptional) || [];

        setState(prev => {
            // Nunca fusionar: cada prenda siempre crea una línea individual
            // para que pueda tener su propio color, notas y fotos
            return {
                ...prev,
                cart: [...prev.cart, {
                    lineId: `${product.id}_${Date.now()}`,
                    productId: product.id,
                    quantity: 1,
                    name: product.name,
                    type: product.type || 'service',
                    basePrice: Number(product.basePrice),
                    bigClientPrice: product.bigClientPrice ? Number(product.bigClientPrice) : 0,
                    countsForLoad: product.countsForLoad !== false, // base del suplemento de urgencia
                    notes: '',
                    photos: [],
                    color: null,
                    optionalStepIds: [],
                    availableOptionalSteps: optionalSteps,
                }],
            };
        });
    }, []);

    const updateQuantity = useCallback((lineId, newQty) => {
        setState(prev => ({
            ...prev,
            cart: newQty <= 0
                ? prev.cart.filter(c => c.lineId !== lineId)
                : prev.cart.map(c => c.lineId === lineId ? { ...c, quantity: newQty } : c),
        }));
    }, []);

    const removeFromCart = useCallback((lineId) => {
        setState(prev => ({ ...prev, cart: prev.cart.filter(c => c.lineId !== lineId) }));
    }, []);

    /* ── Acciones del cliente ── */

    const setSelectedUser = useCallback((user) => {
        setState(prev => {
            // Los precios pactados son del cliente: al cambiar de cliente se
            // descartan y el efecto de abajo pide los del nuevo.
            const mismoCliente = (user?.id ?? null) === (prev.selectedUser?.id ?? null);
            return {
                ...prev,
                selectedUser: user,
                quickClient: user ? { firstName: '', lastName: '', phone: '', email: '' } : prev.quickClient,
                clientPrices: mismoCliente ? prev.clientPrices : {},
                clientPricesFor: mismoCliente ? prev.clientPricesFor : null,
            };
        });
    }, []);

    // Precios pactados del cliente seleccionado. Se piden aquí y no en el TPV
    // porque el borrador también puede nacer desde el chat; al recargar la
    // página se refrescan los que hubiera guardados.
    const selectedClientId = state.selectedUser?.id ?? null;
    useEffect(() => {
        if (!token || !selectedClientId) return undefined;
        let vigente = true;
        fetchEffectivePrices(token, selectedClientId)
            .then((precios) => {
                if (!vigente) return;
                setState(prev => (prev.selectedUser?.id === selectedClientId
                    ? { ...prev, clientPrices: precios || {}, clientPricesFor: selectedClientId }
                    : prev));
            })
            .catch((e) => {
                // Sin ellos el carrito enseña la tarifa normal; el backend cobra igualmente el pactado.
                console.warn('No se pudieron cargar los precios pactados del cliente', e);
            });
        return () => { vigente = false; };
    }, [token, selectedClientId]);

    const setQuickClient = useCallback((fields) => {
        setState(prev => ({
            ...prev,
            quickClient: { ...prev.quickClient, ...fields },
            selectedUser: null,
            clientPrices: {},
            clientPricesFor: null,
        }));
    }, []);

    /* ── Acciones del pedido ── */

    const setFechaLimite = useCallback((date) => {
        setState(prev => ({ ...prev, fechaLimite: date }));
    }, []);

    const setObservaciones = useCallback((text) => {
        setState(prev => ({ ...prev, observaciones: text }));
    }, []);

    const setSinSuplemento = useCallback((valor) => {
        setState(prev => ({ ...prev, sinSuplemento: !!valor }));
    }, []);

    const clearDraft = useCallback(() => {
        setState({ ...defaultState, quickClient: { ...defaultState.quickClient } });
        sessionStorage.removeItem(STORAGE_KEY);
    }, []);

    /* ── Notas y fotos por línea ── */

    const updateLineNotes = useCallback((lineId, notes) => {
        setState(prev => ({
            ...prev,
            cart: prev.cart.map(c => c.lineId === lineId ? { ...c, notes } : c),
        }));
    }, []);

    const addLinePhoto = useCallback((lineId, dataUrl) => {
        setState(prev => ({
            ...prev,
            cart: prev.cart.map(c =>
                c.lineId === lineId ? { ...c, photos: [...(c.photos || []), dataUrl] } : c
            ),
        }));
    }, []);

    const removeLinePhoto = useCallback((lineId, photoIndex) => {
        setState(prev => ({
            ...prev,
            cart: prev.cart.map(c =>
                c.lineId === lineId
                    ? { ...c, photos: (c.photos || []).filter((_, i) => i !== photoIndex) }
                    : c
            ),
        }));
    }, []);

    // Toggle un paso opcional para una línea
    const toggleOptionalStep = useCallback((lineId, stepId) => {
        setState(prev => ({
            ...prev,
            cart: prev.cart.map(c => {
                if (c.lineId !== lineId) return c;
                const ids = c.optionalStepIds || [];
                const has = ids.includes(stepId);
                return { ...c, optionalStepIds: has ? ids.filter(id => id !== stepId) : [...ids, stepId] };
            }),
        }));
    }, []);

    // Establecer color de prenda
    const setLineColor = useCallback((lineId, color) => {
        setState(prev => ({
            ...prev,
            cart: prev.cart.map(c => c.lineId === lineId ? { ...c, color } : c),
        }));
    }, []);

    // Desglosar una línea con qty > 1 en líneas individuales
    const splitLine = useCallback((lineId) => {
        setState(prev => {
            const line = prev.cart.find(c => c.lineId === lineId);
            if (!line || line.quantity <= 1) return prev;

            const newLines = [];
            for (let i = 0; i < line.quantity; i++) {
                newLines.push({
                    ...line,
                    lineId: `${line.productId}_${Date.now()}_${i}`,
                    quantity: 1,
                    notes: i === 0 ? line.notes : '',
                    photos: i === 0 ? (line.photos || []) : [],
                    optionalStepIds: [...(line.optionalStepIds || [])],
                    availableOptionalSteps: line.availableOptionalSteps || [],
                });
            }
            return {
                ...prev,
                cart: prev.cart.flatMap(c => c.lineId === lineId ? newLines : [c]),
            };
        });
    }, []);

    /* ── Valores computados ── */

    // Precio pactado vigente del cliente para un producto, o null si no hay.
    const agreedPriceFor = useCallback((productId) => {
        const user = state.selectedUser;
        if (!user || state.clientPricesFor !== user.id) return null;
        const pactado = state.clientPrices?.[productId];
        return pactado ? Number(pactado.price) : null;
    }, [state.selectedUser, state.clientPrices, state.clientPricesFor]);

    // Replica la regla del backend (utils/precioLinea.js) sólo para mostrar
    // importes; el precio que se guarda lo calcula siempre el backend.
    const getPriceForItem = useCallback((item) => {
        // El precio pactado es el precio final: sin descuento del cliente.
        const pactado = agreedPriceFor(item.productId);
        if (pactado !== null) return pactado;

        const user = state.selectedUser;
        const isbigclient = user?.isbigclient;
        const discountPct = Number(user?.discount || 0);

        let price = (isbigclient && item.bigClientPrice && item.bigClientPrice > 0)
            ? Number(item.bigClientPrice)
            : Number(item.basePrice);

        if (!isNaN(discountPct) && discountPct > 0) {
            const factor = Math.max(0, Math.min(100, discountPct));
            price = price * (1 - factor / 100);
        }
        return price;
    }, [state.selectedUser, agreedPriceFor]);

    const total = useMemo(() =>
        (state.cart || []).reduce((sum, item) => sum + getPriceForItem(item) * item.quantity, 0),
        [state.cart, getPriceForItem]
    );

    const itemCount = useMemo(() =>
        (state.cart || []).reduce((sum, c) => sum + c.quantity, 0),
        [state.cart]
    );

    // Suplemento de urgencia: si la entrega es anterior a la fecha sugerida,
    // % sobre las prendas que computan en la carga (lo externo no se acelera).
    // Es sólo una previsión; el importe que vale lo calcula el backend al crear
    // el pedido (POST /api/orders), con la misma regla.
    const suplementoUrgencia = useMemo(() => {
        const { suggestedDate, urgencyPct } = calendarInfo;
        const adelantada = !!(state.fechaLimite && suggestedDate && state.fechaLimite < suggestedDate);
        if (!adelantada || !(urgencyPct > 0)) return { adelantada, pct: urgencyPct || 0, importe: 0, aplicado: false };
        const base = (state.cart || []).reduce((sum, item) =>
            sum + (item.countsForLoad === false ? 0 : getPriceForItem(item) * item.quantity), 0);
        const importe = Math.round(base * urgencyPct) / 100;
        return { adelantada, pct: urgencyPct, importe, aplicado: importe > 0 && !state.sinSuplemento };
    }, [calendarInfo, state.fechaLimite, state.cart, state.sinSuplemento, getPriceForItem]);

    const totalConSuplemento = useMemo(() =>
        total + (suplementoUrgencia.aplicado ? suplementoUrgencia.importe : 0),
        [total, suplementoUrgencia]
    );

    const clientName = useMemo(() => {
        if (state.selectedUser) {
            return `${state.selectedUser.firstName || ''} ${state.selectedUser.lastName || ''}`.trim();
        }
        if (state.quickClient?.firstName || state.quickClient?.lastName) {
            return `${state.quickClient.firstName} ${state.quickClient.lastName}`.trim();
        }
        return null;
    }, [state.selectedUser, state.quickClient]);

    const discount = useMemo(() => Number(state.selectedUser?.discount || 0), [state.selectedUser]);

    const isActive = (state.cart || []).length > 0;

    const value = useMemo(() => ({
        cart: state.cart,
        selectedUser: state.selectedUser,
        quickClient: state.quickClient,
        fechaLimite: state.fechaLimite,
        observaciones: state.observaciones,
        sinSuplemento: state.sinSuplemento,
        addToCart, updateQuantity, removeFromCart,
        setSelectedUser, setQuickClient,
        setFechaLimite, setObservaciones, setSinSuplemento,
        clearDraft,
        updateLineNotes, addLinePhoto, removeLinePhoto, splitLine,
        toggleOptionalStep, setLineColor,
        getPriceForItem, agreedPriceFor,
        total, itemCount, clientName, discount, isActive,
        calendarInfo, setCalendarInfo, suplementoUrgencia, totalConSuplemento,
        bannerHeight, setBannerHeight,
    }), [state, addToCart, updateQuantity, removeFromCart, setSelectedUser, setQuickClient,
        setFechaLimite, setObservaciones, setSinSuplemento, clearDraft,
        updateLineNotes, addLinePhoto, removeLinePhoto, splitLine,
        toggleOptionalStep, setLineColor,
        getPriceForItem, agreedPriceFor, total, itemCount, clientName, discount, isActive,
        calendarInfo, suplementoUrgencia, totalConSuplemento, bannerHeight]);

    return (
        <DraftOrderContext.Provider value={value}>
            {children}
        </DraftOrderContext.Provider>
    );
}

