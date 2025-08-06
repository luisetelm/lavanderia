// src/components/AuthRedirect.jsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AuthRedirect({ children }) {
    const navigate = useNavigate();

    useEffect(() => {
        const handleUnauthorized = () => {
            navigate('/login');
        };

        window.addEventListener('unauthorized', handleUnauthorized);
        return () => {
            window.removeEventListener('unauthorized', handleUnauthorized);
        };
    }, [navigate]);

    return children;
}