import React from 'react';

export default function ProductList({ products, searchProduct, setSearchProduct, onAdd }) {
    const filtered = products.filter((p) =>
        p.name.toLowerCase().includes(searchProduct.toLowerCase())
    );

    return (
        <div>
            <h2>Productos</h2>
            <input
                placeholder="Buscar producto..."
                value={searchProduct}
                onChange={(e) => setSearchProduct(e.target.value)}
                style={{ width: '100%', marginBottom: 8 }}
            />
            <div>
                {filtered.map((p) => (
                    <div
                        key={p.id}
                        style={{
                            border: '1px solid #ddd',
                            padding: 8,
                            marginBottom: 6,
                            borderRadius: 4,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        <div>
                            <div>{p.name}</div>
                            <div style={{ fontSize: 12 }}>{p.basePrice.toFixed(2)} €</div>
                        </div>
                        <button onClick={() => onAdd(p)}>Añadir</button>
                    </div>
                ))}
                {filtered.length === 0 && <div style={{ color: '#888' }}>No hay productos.</div>}
            </div>
        </div>
    );
}
