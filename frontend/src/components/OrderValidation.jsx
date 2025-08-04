import React from 'react';

export default function OrderValidation({
  cart,
  selectedUser,
  quickFirstName,
  quickLastName,
  quickClientPhone,
  quickClientEmail,
  isValidSpanishPhone,
  fechaLimite,
  observaciones,
  onValidate,
}) {
  return (
    <div>
      <div style={{ marginTop: 12 }}>
        <label>Observaciones:</label>
        <textarea
          placeholder="Prenda en mal estado, petición especial..."
          value={observaciones}
          onChange={(e) => onValidate({ observaciones: e.target.value })}
          style={{ width: '100%', minHeight: 60 }}
        />
      </div>
      <button
        onClick={() => onValidate({ submit: true })}
        disabled={!cart.length}
        style={{ marginTop: 10 }}
      >
        Validar pedido
      </button>
    </div>
  );
}
