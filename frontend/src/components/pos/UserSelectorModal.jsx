import React from 'react';

export default function UserSelectorModal({
    show,
    onClose,
    userSearchTerm,
    setUserSearchTerm,
    userResults,
    onSelectUser,
}) {
    if (!show) return null;

    return (
        <div className="uk-modal uk-open" style={{display: 'block', zIndex: 1100}}>
            <div className="uk-modal-dialog">
                <div className="uk-modal-header">
                    <h3 className="uk-modal-title">Seleccionar Usuario</h3>
                    <button className="uk-modal-close-default" type="button" uk-close
                            onClick={onClose}></button>
                </div>
                <div className="uk-modal-body" style={{maxHeight: '60vh', overflow: 'auto'}}>
                    <div className="uk-margin">
                        <input
                            className="uk-input"
                            type="text"
                            placeholder="Buscar usuario..."
                            value={userSearchTerm}
                            onChange={e => setUserSearchTerm(e.target.value)}
                        />
                    </div>
                    <ul className="uk-list uk-list-divider">
                        {Array.isArray(userResults) && userResults.map(user => (<li key={user.id}
                                                                                    className="uk-flex uk-flex-between uk-flex-middle"
                                                                                    style={{
                                                                                        cursor: 'pointer',
                                                                                        padding: '8px'
                                                                                    }}
                                                                                    onClick={() => onSelectUser(user)}
                        >
                            <div>
                                <div>{user.firstName} {user.lastName}</div>
                                <div className="uk-text-small uk-text-muted">{user.phone || user.email}</div>
                            </div>
                            <div className="uk-label">{user.role}</div>
                        </li>))}
                        {(!Array.isArray(userResults) || userResults.length === 0) && (
                            <li className="uk-text-center uk-text-muted">No se encontraron usuarios</li>)}
                    </ul>
                </div>
                <div className="uk-modal-footer uk-text-right">
                    <button className="uk-button uk-button-default"
                            onClick={onClose}>Cerrar
                    </button>
                </div>
            </div>
            <div className="uk-modal-bg" onClick={onClose}></div>
        </div>
    );
}
