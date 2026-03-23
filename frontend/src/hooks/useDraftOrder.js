import { useContext } from 'react';
import { DraftOrderContext } from '../context/DraftOrderContext.jsx';

export function useDraftOrder() {
    const ctx = useContext(DraftOrderContext);
    if (!ctx) throw new Error('useDraftOrder debe usarse dentro de DraftOrderProvider');
    return ctx;
}
