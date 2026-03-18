import React from 'react';

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 40, textAlign: 'center' }}>
                    <h3>Algo ha ido mal</h3>
                    <p style={{ color: '#666' }}>
                        {this.state.error?.message || 'Error inesperado en la aplicación'}
                    </p>
                    <button
                        className="uk-button uk-button-primary"
                        onClick={() => {
                            this.setState({ hasError: false, error: null });
                            window.location.reload();
                        }}
                    >
                        Recargar
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
