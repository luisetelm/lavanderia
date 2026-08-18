import { useContext } from 'react';
import { MessagesContext } from '../context/MessagesContext.jsx';

export function useMessages() {
    const ctx = useContext(MessagesContext);
    if (!ctx) throw new Error('useMessages debe usarse dentro de MessagesProvider');
    return ctx;
}
