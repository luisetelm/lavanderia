import React from 'react';

export default function Pagination({ meta, onPageChange }) {
    const { page, totalPages, hasPrevPage, hasNextPage } = meta;
    const current = page + 1;

    // Genera los números de página visibles con ellipsis
    const getVisiblePages = () => {
        if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
        const pages = [];
        pages.push(1);
        if (current > 3) pages.push('...');
        for (let i = Math.max(2, current - 1); i <= Math.min(totalPages - 1, current + 1); i++) {
            pages.push(i);
        }
        if (current < totalPages - 2) pages.push('...');
        pages.push(totalPages);
        return pages;
    };

    return (
        <ul className="uk-pagination uk-flex-center" style={{ marginTop: 16 }}>
            <li className={hasPrevPage ? '' : 'uk-disabled'}>
                <button
                    className="uk-button uk-button-text"
                    disabled={!hasPrevPage}
                    onClick={() => onPageChange(current - 1)}>
                    <span uk-pagination-previous="true" />
                </button>
            </li>
            {getVisiblePages().map((p, i) =>
                p === '...' ? (
                    <li key={`e${i}`} className="uk-disabled">
                        <span style={{ padding: '0 6px' }}>…</span>
                    </li>
                ) : (
                    <li key={p} className={current === p ? 'uk-active' : ''}>
                        <button
                            className="uk-button uk-button-text"
                            onClick={() => onPageChange(p)}>
                            {p}
                        </button>
                    </li>
                )
            )}
            <li className={hasNextPage ? '' : 'uk-disabled'}>
                <button
                    className="uk-button uk-button-text"
                    disabled={!hasNextPage}
                    onClick={() => onPageChange(current + 1)}>
                    <span uk-pagination-next="true" />
                </button>
            </li>
        </ul>
    );
}