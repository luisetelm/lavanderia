let counter = 0;
export default function nextOrderNum() {
    const year = new Date().getFullYear();
    counter += 1;
    return `TPV/${year}/${String(counter).padStart(4, '0')}`;
}

