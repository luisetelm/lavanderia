import React, { useState } from 'react';

export default function ProductList({products, searchProduct, setSearchProduct, onAdd}) {
    const [hoveredProduct, setHoveredProduct] = useState(null);
    
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
                style={{width: '100%', marginBottom: 8}}
            />
            <div style={{
                display: 'grid',
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
            }}>
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
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            backgroundColor: hoveredProduct === p.id ? '#f0f4ff' : 'white',
                            transform: hoveredProduct === p.id ? 'translateY(-2px)' : 'none',
                            boxShadow: hoveredProduct === p.id 
                                ? '0 4px 6px rgba(0, 0, 0, 0.1)' 
                                : '0 1px 3px rgba(0, 0, 0, 0.05)',
                        }}
                        onClick={() => onAdd(p)}
                        onMouseEnter={() => setHoveredProduct(p.id)}
                        onMouseLeave={() => setHoveredProduct(null)}
                    >
                        <div>
                            <div style={{
                                fontWeight: hoveredProduct === p.id ? '500' : 'normal',
                                color: '#1f2956'
                            }}>
                                {p.name}
                            </div>
                            <div style={{
                                fontSize: 12,
                                color: hoveredProduct === p.id ? '#4b5563' : '#666'
                            }}>
                                {p.basePrice.toFixed(2)} €
                            </div>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && <div style={{color: '#888'}}>No hay productos.</div>}
            </div>
        </div>
    );
}
