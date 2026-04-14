import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';

export const DraftOrderContext = createContext(null);

const STORAGE_KEY = 'draftOrder';
const STORAGE_VERSION = 3; // Incrementar si cambia la estructura

const defaultState = {
    cart: [],              // [{ productId, quantity, name, basePrice, bigClientPrice }]
    selectedUser: null,    // { id, firstName, lastName, phone, email, isbigclient, discount, notifyChannel }
    quickClient: { firstName: '', lastName: '', phone: '', email: '' },
    fechaLimite: null,
    observaciones: '',
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

export function DraftOrderProvider({ children }) {
    const [state, setState] = useState(() => loadFromStorage() || { ...defaultState, quickClient: { ...defaultState.quickClient } });
    const [bannerHeight, setBannerHeight] = useState(0);

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
        setState(prev => ({
            ...prev,
            selectedUser: user,
            quickClient: user ? { firstName: '', lastName: '', phone: '', email: '' } : prev.quickClient,
        }));
    }, []);

    const setQuickClient = useCallback((fields) => {
        setState(prev => ({
            ...prev,
            quickClient: { ...prev.quickClient, ...fields },
            selectedUser: null,
        }));
    }, []);

    /* ── Acciones del pedido ── */

    const setFechaLimite = useCallback((date) => {
        setState(prev => ({ ...prev, fechaLimite: date }));
    }, []);

    const setObservaciones = useCallback((text) => {
        setState(prev => ({ ...prev, observaciones: text }));
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

    const getPriceForItem = useCallback((item) => {
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
    }, [state.selectedUser]);

    const total = useMemo(() =>
        (state.cart || []).reduce((sum, item) => sum + getPriceForItem(item) * item.quantity, 0),
        [state.cart, getPriceForItem]
    );

    const itemCount = useMemo(() =>
        (state.cart || []).reduce((sum, c) => sum + c.quantity, 0),
        [state.cart]
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
        addToCart, updateQuantity, removeFromCart,
        setSelectedUser, setQuickClient,
        setFechaLimite, setObservaciones,
        clearDraft,
        updateLineNotes, addLinePhoto, removeLinePhoto, splitLine,
        toggleOptionalStep, setLineColor,
        getPriceForItem,
        total, itemCount, clientName, discount, isActive,
        bannerHeight, setBannerHeight,
    }), [state, addToCart, updateQuantity, removeFromCart, setSelectedUser, setQuickClient,
        setFechaLimite, setObservaciones, clearDraft,
        updateLineNotes, addLinePhoto, removeLinePhoto, splitLine,
        toggleOptionalStep, setLineColor,
        getPriceForItem, total, itemCount, clientName, discount, isActive, bannerHeight]);

    return (
        <DraftOrderContext.Provider value={value}>
            {children}
        </DraftOrderContext.Provider>
    );
}

