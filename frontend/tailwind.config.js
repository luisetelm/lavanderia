// javascript
/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{js,jsx,ts,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                // opcional: tu paleta personalizada
                primary: {
                    DEFAULT: '#4f46e5',
                    50: '#eef2ff',
                },
            },
        },
    },
    plugins: [],
};