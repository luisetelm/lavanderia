import React from 'react';

/**
 * Modal reutilizable para confirmar un cambio de estado de pedido
 * y elegir cómo notificar al cliente.
 *
 * Props:
 *  - action: 'ready' | 'collected' | null  (null = cerrado)
 *  - clientChannel: 'sms' | 'whatsapp' | 'none' | null (preferencia guardada del cliente)
 *  - onConfirm(sendSMS): se llama con false | true | 'whatsapp'
 *  - onCancel(): cierra el modal
 */
export default function StatusChangeModal({ action, clientChannel, onConfirm, onCancel }) {
    if (!action) return null;

    const title = action === 'ready' ? '¿Marcar como listo?' : '¿Marcar como recogido?';
    const description = action === 'collected'
        ? 'Al marcar como recogido se enviará una petición de reseña al cliente.'
        : 'Se notificará al cliente que su pedido está listo para recoger.';

    const preferred = clientChannel || null;
    const hasPref = preferred === 'sms' || preferred === 'whatsapp';
    const optedOut = preferred === 'none';

    return (
        <div className="uk-modal uk-open" style={{ display: 'block' }}>
            <div className="uk-modal-dialog uk-modal-body" style={{ maxWidth: 420 }}>
                <h2 className="uk-modal-title" style={{ fontSize: '1.05rem', marginBottom: 4 }}>{title}</h2>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 20px' }}>{description}</p>

                {optedOut && (
                    <p style={{ fontSize: '0.78rem', color: '#f59e0b', margin: '0 0 12px', fontStyle: 'italic' }}>
                        Este cliente ha indicado que no desea recibir notificaciones.
                    </p>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {hasPref && (
                        <button
                            className="uk-button uk-width-1-1"
                            style={{
                                background: preferred === 'whatsapp' ? '#25D366' : '#048ABF',
                                color: '#fff',
                            }}
                            onClick={() => onConfirm(preferred === 'sms' ? true : 'whatsapp')}
                        >
                            {preferred === 'whatsapp' ? 'Notificar por WhatsApp' : 'Notificar por SMS'}
                            <span style={{ fontSize: '0.7rem', marginLeft: 6, opacity: 0.7 }}>(preferido)</span>
                        </button>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                        {!hasPref && (
                            <>
                                <button className="uk-button uk-button-primary uk-width-1-2" onClick={() => onConfirm(true)}>
                                    SMS
                                </button>
                                <button className="uk-button uk-width-1-2" style={{ background: '#25D366', color: '#fff' }} onClick={() => onConfirm('whatsapp')}>
                                    WhatsApp
                                </button>
                            </>
                        )}

                        {hasPref && preferred === 'whatsapp' && (
                            <button className="uk-button uk-button-primary uk-width-1-2" onClick={() => onConfirm(true)}>SMS</button>
                        )}
                        {hasPref && preferred === 'sms' && (
                            <button className="uk-button uk-width-1-2" style={{ background: '#25D366', color: '#fff' }} onClick={() => onConfirm('whatsapp')}>WhatsApp</button>
                        )}

                        <button
                            className={`uk-button uk-button-default ${hasPref ? 'uk-width-1-2' : 'uk-width-1-1'}`}
                            onClick={() => onConfirm(false)}
                        >
                            Sin notificar
                        </button>
                    </div>
                </div>

                <div style={{ marginTop: 14, textAlign: 'right' }}>
                    <button className="uk-button uk-button-link" onClick={onCancel} style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
}
