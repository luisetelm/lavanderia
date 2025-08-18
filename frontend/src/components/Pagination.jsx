import React from 'react';

export default function Pagination({ meta, onPageChange }) {
    const { page, totalPages, hasPrevPage, hasNextPage } = meta;
    const current = page + 1;
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

    return (
        <ul className="uk-pagination uk-flex-center">
            <li className={hasPrevPage ? '' : 'uk-disabled'}>
                <button
                    className="uk-button uk-button-text"
                    disabled={!hasPrevPage}
                    onClick={() => onPageChange(current - 1)}>
                    <span uk-pagination-previous="true" />
                </button>
            </li>
            {pages.map(p => (
                <li key={p} className={current === p ? 'uk-active' : ''}>
                    <button
                        className="uk-button uk-button-text"
                        onClick={() => onPageChange(p)}>
                        {p}
                    </button>
                </li>
            ))}
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