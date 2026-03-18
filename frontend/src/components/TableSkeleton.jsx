import React from 'react';

export default function TableSkeleton({ rows = 5, cols = 6 }) {
    return (
        <table className="uk-table uk-table-divider uk-table-small">
            <tbody>
                {Array.from({ length: rows }).map((_, r) => (
                    <tr key={r}>
                        {Array.from({ length: cols }).map((_, c) => (
                            <td key={c}>
                                <div style={{
                                    height: 14,
                                    borderRadius: 4,
                                    background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
                                    backgroundSize: '200% 100%',
                                    animation: 'skeleton-shimmer 1.5s infinite',
                                    width: `${50 + Math.random() * 50}%`,
                                }} />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
            <style>{`
                @keyframes skeleton-shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
            `}</style>
        </table>
    );
}
