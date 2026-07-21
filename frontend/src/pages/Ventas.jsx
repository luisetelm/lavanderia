// javascript
import React, {useCallback, useEffect, useState} from 'react';
import { avisar } from '../utils/dialogo.js';
import {
    fetchOrders,
    createInvoice,
    fetchOrder,
    collectInvoicesBatch,
    fetchIncomeReport,
    fetchInvoicesReport
} from '../api.js';
import { formatEUR } from '../utils/format.js';
import {useNavigate} from 'react-router-dom';
import * as XLSX from 'xlsx';
import VentaRow from '../components/VentaRow.jsx';
import PageToolbar from '../components/PageToolbar.jsx';
import DateRangeSelector from '../components/DateRangeSelector.jsx';
import Pagination from '../components/Pagination.jsx';
import { getPrimerDiaMes, getUltimoDiaMes } from '../utils/dates.js';

export default function Ventas({token}) {
    const [fechaInicio, setFechaInicio] = useState(() => localStorage.getItem('ventas_fechaInicio') || getPrimerDiaMes());
    const [fechaFin, setFechaFin] = useState(() => localStorage.getItem('ventas_fechaFin') || getUltimoDiaMes());

    // Vista: 'pedido' = fecha de creación del pedido (como hasta ahora), 'cobro' = fecha real de cobro
    // (Payment.createdAt). Un pedido o factura mensual cobrado en un trimestre distinto al que se
    // creó/emitió sólo aparece en el trimestre correcto en la vista 'cobro'. Pensado para gestoría.
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('ventas_viewMode') || 'pedido');
    const [incomePayments, setIncomePayments] = useState([]);
    const [incomeLoading, setIncomeLoading] = useState(false);

    // Vista 'facturas': listado simple de facturas emitidas en el rango, sin más
    const [invoicesList, setInvoicesList] = useState([]);
    const [invoicesLoading, setInvoicesLoading] = useState(false);

    const [ventas, setVentas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedOrders, setSelectedOrders] = useState([]);
    const [selectionCriteria, setSelectionCriteria] = useState(null);

    // NUEVO: estado de filtros (mutuamente excluyentes por categoría)
    const [paidFilter, setPaidFilter] = useState(null); // 'paid' | 'unpaid' | null
    // Sustituimos el filtro de facturados/no facturados por tipo de factura: 's' simplificada | 'n' normal
    const [invoiceTypeFilter, setInvoiceTypeFilter] = useState(null); // 's' | 'n' | null
    const [methodFilter, setMethodFilter] = useState(null); // 'cash' | 'card' | null
    // NUEVO: solo importes positivos (> 0 €)
    const [onlyPositive, setOnlyPositive] = useState(() => localStorage.getItem('ventas_onlyPositive') === '1');
    // Filtro: facturas emitidas pero sin cobrar
    const [invoiceUnpaidFilter, setInvoiceUnpaidFilter] = useState(false);
    // Estado para batch collect
    const [collectMethod, setCollectMethod] = useState('transfer');
    const [showBatchCollect, setShowBatchCollect] = useState(false);
    // Paginación
    const PAGE_SIZE = 50;
    const [page, setPage] = useState(0);

    // Helper: normalizar una orden para que siempre tenga invoiceTickets como array
    const normalizeOrder = (o) => ({
        ...o,
        invoiceTickets: Array.isArray(o?.invoiceTickets) ? o.invoiceTickets : [],
        client: o?.client || null
    });

    // Helper: saber si está facturado
    const isInvoiced = (o) => Boolean(o?.facturado) || (Array.isArray(o?.invoiceTickets) && o.invoiceTickets.length > 0);

    // Helper: obtener tipos de factura presentes en la orden ('s' y/o 'n')
    const getInvoiceTypes = (o) => {
        const types = new Set();
        if (o.factura === undefined) {
            types.add('sinfactura');
            return types;
        } else {
            if (o.factura.type === 's') types.add('s');
            if (o.factura.type === 'n') types.add('n');
            return types;
        }
    };

    // Refrescar una única orden y actualizar sólo esa fila en el estado (evita recargar toda la lista y perder scroll)
    const refreshOrder = async (orderId) => {
        try {
            const fresh = await fetchOrder(token, orderId);
            setVentas(prev => prev.map(p => p.id === orderId ? normalizeOrder(fresh) : p));
        } catch (err) {
            console.error('Error refrescando orden', err);
            // Si falla, podemos recargar la lista completa como fallback
            try {
                await fetchVentas();
            } catch (e) {
                // noop
            }
        }
    };

    // Exportar ventas actuales a XLSX usando SheetJS (usar lista filtrada)
    const exportVentasXLSX = () => {
        const ventasFiltradas = getVentasFiltradas();
        if (!Array.isArray(ventasFiltradas) || ventasFiltradas.length === 0) {
            avisar('No hay datos para exportar', 'warning');
            return;
        }

        const columns = [
            {key: 'id', label: 'ID'},
            {key: 'orderNum', label: 'Número'},
            {key: 'createdAt', label: 'Fecha (ISO)'},
            {key: 'fechaFormateada', label: 'Fecha'},
            {key: 'clientId', label: 'Cliente ID'},
            {key: 'cliente', label: 'Cliente'},
            {key: 'clientEmail', label: 'Email cliente'},
            {key: 'total', label: 'Total (num)'},
            {key: 'totalFormatted', label: 'Total'},
            {key: 'paid', label: 'Pagado'},
            {key: 'facturado', label: 'Facturado'},
            {key: 'invoiceCount', label: 'Nº Facturas'},
            // Eliminamos columna con números de factura por petición del usuario
            {key: 'paymentMethod', label: 'Método de pago'},
            {key: 'notes', label: 'Notas'},
            {key: 'clienteExtra', label: 'Cliente extra (raw)'}
        ];

        const rows = ventasFiltradas.map(v => {
            const fecha = v.createdAt ? new Date(v.createdAt) : null;
            const fechaFormateada = fecha ? fecha.toLocaleDateString('es-ES', {dateStyle: 'medium'}) : '';
            const cliente = v.client?.denominacionSocial || (v.client?.firstName ? `${v.client.firstName} ${v.client.lastName || ''}` : v.cliente) || '';
            const clientEmail = v.client?.email || '';
            const invoiceCount = Array.isArray(v.invoiceTickets) ? v.invoiceTickets.length : 0;

            // Mapeo amigable del método de pago para la exportación
            const paymentMethod = v.paymentMethod ? (
                v.paymentMethod === 'card' ? 'Tarjeta' :
                    v.paymentMethod === 'cash' ? 'Efectivo' :
                        v.paymentMethod === 'transfer' ? 'Transferencia' :
                            v.paymentMethod
            ) : '';

            return {
                id: v.id || '',
                orderNum: v.orderNum || '',
                createdAt: v.createdAt || '',
                fechaFormateada,
                clientId: v.client?.id || '',
                cliente,
                clientEmail,
                total: typeof v.total === 'number' ? v.total : (v.total ? Number(v.total) : ''),
                totalFormatted: typeof v.total === 'number' ? formatEUR(v.total) : (v.total ? formatEUR(Number(v.total)) : ''),
                paid: typeof v.paid === 'boolean' ? v.paid : !!v.paid,
                facturado: !!v.facturado || invoiceCount > 0,
                invoiceCount,
                paymentMethod,
                notes: v.notes || v.note || '',
                clienteExtra: JSON.stringify(v.client || {})
            };
        });

        // Construir matriz 2D con encabezados en el orden de `columns`
        const aoa = [columns.map(c => c.label)];
        rows.forEach(r => {
            aoa.push(columns.map(c => {
                // Mantener tipos: number/boolean se conservan, resto a string
                const val = r[c.key];
                if (val === null || val === undefined) return '';
                return val;
            }));
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ventas');

        const start = fechaInicio || '';
        const end = fechaFin || '';
        const filename = `ventas_${start}_${end}.xlsx`;

        XLSX.writeFile(wb, filename);
    };


    // Traer cobros reales del rango (vista 'cobro')
    const fetchIncome = useCallback(async () => {
        if (!fechaInicio || !fechaFin) return;
        setIncomeLoading(true);
        try {
            const data = await fetchIncomeReport(token, {from: fechaInicio, to: fechaFin});
            setIncomePayments(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error al cargar ingresos:', err);
        } finally {
            setIncomeLoading(false);
        }
    }, [token, fechaInicio, fechaFin]);

    const nombreCliente = (c) => c?.denominacionsocial || (c?.firstName ? `${c.firstName} ${c.lastName || ''}`.trim() : '') || '';

    const metodoLabel = (m) => (
        m === 'cash' ? 'Efectivo' :
            m === 'card_pos' ? 'Tarjeta' :
                m === 'stripe' ? 'Stripe' :
                    m === 'transfer' ? 'Transferencia' : (m || '')
    );

    const totalIngresos = incomePayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalIngresosSinEfectivo = incomePayments
        .filter(p => p.method !== 'cash')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalIngresosEfectivo = totalIngresos - totalIngresosSinEfectivo;
    const facturasHuerfanas = incomePayments.filter(p => p.orphan);
    const totalFacturasHuerfanas = facturasHuerfanas.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // Exportar el listado de cobros (secuencial por fecha) a XLSX para gestoría
    const exportIngresosXLSX = () => {
        if (incomePayments.length === 0) {
            avisar('No hay cobros para exportar', 'warning');
            return;
        }
        const columns = [
            {key: 'num', label: 'Nº'},
            {key: 'fecha', label: 'Fecha cobro (ISO)'},
            {key: 'fechaFormateada', label: 'Fecha cobro'},
            {key: 'cliente', label: 'Cliente'},
            {key: 'clientEmail', label: 'Email cliente'},
            {key: 'pedido', label: 'Pedido'},
            {key: 'facturaNum', label: 'Nº Factura'},
            {key: 'metodo', label: 'Método'},
            {key: 'importe', label: 'Importe (num)'},
            {key: 'importeFormatted', label: 'Importe'},
            {key: 'aviso', label: 'Aviso'},
        ];
        const rows = incomePayments.map((p, i) => {
            const fecha = p.createdAt ? new Date(p.createdAt) : null;
            return {
                num: i + 1,
                fecha: p.createdAt || '',
                fechaFormateada: fecha ? fecha.toLocaleDateString('es-ES', {dateStyle: 'medium'}) : '',
                cliente: nombreCliente(p.client),
                clientEmail: p.client?.email || '',
                pedido: p.orderLabel || p.order?.orderNum || '',
                facturaNum: p.invoiceNumber || '',
                metodo: p.orphan ? '' : metodoLabel(p.method),
                importe: Number(p.amount) || 0,
                importeFormatted: formatEUR(Number(p.amount) || 0),
                aviso: p.orphan ? 'Factura emitida sin pago registrado' : '',
            };
        });

        const aoa = [columns.map(c => c.label)];
        const rowToArray = (r) => columns.map(c => (r[c.key] === null || r[c.key] === undefined) ? '' : r[c.key]);
        rows.forEach(r => aoa.push(rowToArray(r)));
        // Fila de totales al final
        aoa.push([]);
        aoa.push(rowToArray({metodo: 'Total', importe: totalIngresos, importeFormatted: formatEUR(totalIngresos)}));
        aoa.push(rowToArray({metodo: 'Total sin efectivo', importe: totalIngresosSinEfectivo, importeFormatted: formatEUR(totalIngresosSinEfectivo)}));
        aoa.push(rowToArray({metodo: 'Total efectivo', importe: totalIngresosEfectivo, importeFormatted: formatEUR(totalIngresosEfectivo)}));
        if (facturasHuerfanas.length > 0) {
            aoa.push(rowToArray({
                metodo: 'De las cuales, sin pago registrado',
                importe: totalFacturasHuerfanas,
                importeFormatted: formatEUR(totalFacturasHuerfanas),
                aviso: `${facturasHuerfanas.length} factura(s)`,
            }));
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ingresos');
        XLSX.writeFile(wb, `ingresos_${fechaInicio || ''}_${fechaFin || ''}.xlsx`);
    };

    // Traer el listado simple de facturas emitidas en el rango (vista 'facturas')
    const fetchInvoicesList = useCallback(async () => {
        if (!fechaInicio || !fechaFin) return;
        setInvoicesLoading(true);
        try {
            const data = await fetchInvoicesReport(token, {from: fechaInicio, to: fechaFin});
            setInvoicesList(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error al cargar facturas:', err);
        } finally {
            setInvoicesLoading(false);
        }
    }, [token, fechaInicio, fechaFin]);

    const totalFacturasGross = invoicesList.reduce((sum, f) => sum + (Number(f.totalGross) || 0), 0);
    const totalFacturasNet = invoicesList.reduce((sum, f) => sum + (Number(f.totalNet) || 0), 0);
    const totalFacturasTax = invoicesList.reduce((sum, f) => sum + (Number(f.totalTax) || 0), 0);

    const exportFacturasXLSX = () => {
        if (invoicesList.length === 0) {
            avisar('No hay facturas para exportar', 'warning');
            return;
        }
        const columns = [
            {key: 'num', label: 'Nº'},
            {key: 'factura', label: 'Nº Factura'},
            {key: 'tipo', label: 'Tipo'},
            {key: 'rectifica', label: 'Rectifica a'},
            {key: 'fecha', label: 'Fecha emisión'},
            {key: 'cliente', label: 'Cliente'},
            {key: 'base', label: 'Base imponible'},
            {key: 'iva', label: 'IVA'},
            {key: 'total', label: 'Total'},
        ];
        const rows = invoicesList.map((f, i) => ({
            num: i + 1,
            factura: f.number || '',
            // La gestoría necesita distinguir las rectificativas y a qué factura
            // corrigen; sus importes van en negativo y restan del total.
            tipo: f.isRectifying ? 'Rectificativa' : (f.type === 'n' ? 'Normal' : 'Simplificada'),
            rectifica: f.isRectifying ? (f.invoices?.number || '') : '',
            fecha: f.issuedAt ? new Date(f.issuedAt).toLocaleDateString('es-ES', {dateStyle: 'medium'}) : '',
            cliente: nombreCliente(f.User),
            base: Number(f.totalNet) || 0,
            iva: Number(f.totalTax) || 0,
            total: Number(f.totalGross) || 0,
        }));
        const aoa = [columns.map(c => c.label)];
        rows.forEach(r => aoa.push(columns.map(c => (r[c.key] === null || r[c.key] === undefined) ? '' : r[c.key])));
        aoa.push([]);
        aoa.push(['', '', '', '', '', 'Total', totalFacturasNet, totalFacturasTax, totalFacturasGross]);

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
        XLSX.writeFile(wb, `facturas_${fechaInicio || ''}_${fechaFin || ''}.xlsx`);
    };

    const navigate = useNavigate();

    const verPedido = (o) => {
        navigate('/tareas', {
            state: {
                filterOrderId: o.id, orderNumber: o.orderNum || o.id
            }
        });
    };

    // Buscar ventas por rango de fechas usando fetchOrders
    const fetchVentas = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (fechaInicio) params.startDate = fechaInicio;
            if (fechaFin) params.endDate = fechaFin;
            const data = await fetchOrders(token, params);
            // Normalizar para evitar errores al acceder a invoiceTickets
            setVentas(Array.isArray(data) ? data.map(normalizeOrder) : []);
        } catch (err) {
            console.error('Error al cargar ventas:', err);
        } finally {
            setLoading(false);
        }
    }, [fechaInicio, fechaFin]);

    // NUEVO: aplicar filtros a la lista
    const getVentasFiltradas = () => {
        return ventas.filter(v => {
            // paid
            if (paidFilter === 'paid' && !v.paid) return false;
            if (paidFilter === 'unpaid' && v.paid) return false;
            // invoice type: si hay filtro, incluir solo pedidos que tengan alguna factura del tipo seleccionado
            if (invoiceTypeFilter) {
                const types = getInvoiceTypes(v);
                if (!types.has(invoiceTypeFilter)) return false;
            }
            // payment method
            if (methodFilter === 'cash' && v.paymentMethod !== 'cash') return false;
            if (methodFilter === 'card' && v.paymentMethod !== 'card') return false;
            // NUEVO: solo importes > 0
            const totalNum = Number(v.total);
            if (onlyPositive && !(totalNum > 0)) return false;
            // Filtro: facturas sin cobrar (facturado pero factura no cobrada)
            if (invoiceUnpaidFilter) {
                const inv = v.factura;
                if (!inv) return false; // no facturado, excluir
                if (inv.paid === true || inv.paymentStatus === 'paid') return false; // ya cobrada
            }
            return true;
        });
    };

    // Calcula KPIs sobre la lista filtrada
    const ventasFiltradas = getVentasFiltradas();
    const totalVentas = ventasFiltradas.reduce((sum, v) => sum + (Number(v.total) || 0), 0);
    const cantidadPedidos = ventasFiltradas.length;
    const pedidosPendientes = ventasFiltradas.filter(v => v.paid === false).length;
    const pedidosFacturados = ventasFiltradas.filter(v => isInvoiced(v)).length;
    // KPI: facturas emitidas sin cobrar
    const facturasSinCobrar = ventas.filter(v => {
        const inv = v.factura;
        return inv && inv.paid !== true && inv.paymentStatus !== 'paid';
    });
    const totalSinCobrar = facturasSinCobrar.reduce((sum, v) => sum + (Number(v.total) || 0), 0);

    // Paginación sobre los datos filtrados
    const totalPages = Math.ceil(ventasFiltradas.length / PAGE_SIZE);
    const safePage = Math.min(page, Math.max(totalPages - 1, 0));
    const ventasPaginadas = ventasFiltradas.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    const paginationMeta = {
        page: safePage,
        totalPages,
        total: ventasFiltradas.length,
        hasPrevPage: safePage > 0,
        hasNextPage: safePage < totalPages - 1,
    };

    // Resetear página al cambiar filtros o fechas
    useEffect(() => {
        setPage(0);
    }, [paidFilter, invoiceTypeFilter, methodFilter, onlyPositive, invoiceUnpaidFilter, fechaInicio, fechaFin]);


    useEffect(() => {
        if (viewMode === 'cobro') {
            fetchIncome();
        } else if (viewMode === 'facturas') {
            fetchInvoicesList();
        } else {
            fetchVentas();
        }
    }, [viewMode, fetchVentas, fetchIncome, fetchInvoicesList]);

    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        localStorage.setItem('ventas_viewMode', mode);
    };

    // Cobrar facturas seleccionadas en batch
    const handleBatchCollect = async () => {
        // Obtener los IDs de facturas de los pedidos seleccionados que tienen factura sin cobrar
        const invoiceIds = selectedOrders
            .map(orderId => ventas.find(v => v.id === orderId))
            .filter(v => v?.factura && v.factura.paid !== true && v.factura.paymentStatus !== 'paid')
            .map(v => v.factura.id);

        if (invoiceIds.length === 0) {
            avisar('No hay facturas sin cobrar en la selección', 'warning');
            return;
        }
        setLoading(true);
        try {
            await collectInvoicesBatch(token, invoiceIds, collectMethod);
            setShowBatchCollect(false);
            setSelectedOrders([]);
            setSelectionCriteria(null);
            await fetchVentas();
        } catch (e) {
            avisar(e.error || 'Error cobrando facturas', 'danger');
        } finally {
            setLoading(false);
        }
    };

    // Facturar todos los pedidos seleccionados
    const handleGenerateInvoices = async () => {
        if (selectedOrders.length === 0) return;
        setLoading(true);
        try {
            await createInvoice(token, {orderIds: selectedOrders, type: 'n'});
            await fetchVentas();
            setSelectedOrders([]);
            setSelectionCriteria(null);
        } catch (e) {
            avisar(e.error || 'Error generando facturas', 'danger');
        } finally {
            setLoading(false);
        }
    };

    // Función para manejar la selección de pedidos
    const handleSelectOrder = (order) => {
        const isSelected = selectedOrders.includes(order.id);
        let newSelectedOrders;
        if (isSelected) {
            newSelectedOrders = selectedOrders.filter(id => id !== order.id);
        } else {
            newSelectedOrders = [...selectedOrders, order.id];
        }
        if (newSelectedOrders.length === 0) {
            setSelectionCriteria(null);
        } else if (!isSelected && newSelectedOrders.length === 1) {
            setSelectionCriteria({
                clientId: order.client?.id,
                paid: order.paid
            });
        }
        setSelectedOrders(newSelectedOrders);
    };


    // Actualizar: no permitir seleccionar pedidos facturados (usando invoiceTickets)
    const canSelectOrder = (order) => {
        if (isInvoiced(order)) return false;
        if (!selectionCriteria) return true;
        return (
            order.client?.id === selectionCriteria.clientId &&
            order.paid === selectionCriteria.paid
        );
    };

    // Handlers de filtros con toggle
    const togglePaid = (which) => {
        setPaidFilter(prev => prev === which ? null : which);
    };
    const toggleInvoiceType = (which) => {
        setInvoiceTypeFilter(prev => prev === which ? null : which);
    };
    const toggleMethod = (which) => {
        setMethodFilter(prev => prev === which ? null : which);
    };
    const clearFilters = () => {
        setPaidFilter(null);
        setInvoiceTypeFilter(null);
        setMethodFilter(null);
        setOnlyPositive(false);
        setInvoiceUnpaidFilter(false);
        localStorage.setItem('ventas_onlyPositive', '0');
    };
    // NUEVO: toggle para importes > 0 €
    const toggleOnlyPositive = () => {
        setOnlyPositive(prev => {
            const next = !prev;
            localStorage.setItem('ventas_onlyPositive', next ? '1' : '0');
            return next;
        });
    };


    const toolbarFilters = [
        {
            label: 'Cobro',
            active: !!paidFilter,
            options: [
                { label: 'Todos', active: !paidFilter, onClick: () => setPaidFilter(null) },
                { label: 'Pendientes', active: paidFilter === 'unpaid', onClick: () => togglePaid('unpaid') },
                { label: 'Cobrados', active: paidFilter === 'paid', onClick: () => togglePaid('paid') },
            ]
        },
        {
            label: 'Factura',
            active: !!invoiceTypeFilter || invoiceUnpaidFilter,
            options: [
                { label: 'Sin facturar', active: invoiceTypeFilter === 'sinfactura', onClick: () => toggleInvoiceType('sinfactura') },
                { label: 'Simplificada', active: invoiceTypeFilter === 's', onClick: () => toggleInvoiceType('s') },
                { label: 'Normal', active: invoiceTypeFilter === 'n', onClick: () => toggleInvoiceType('n') },
                { label: 'Sin cobrar', active: invoiceUnpaidFilter, onClick: () => setInvoiceUnpaidFilter(prev => !prev) },
            ]
        },
        {
            label: 'Método',
            active: !!methodFilter,
            options: [
                { label: 'Efectivo', active: methodFilter === 'cash', onClick: () => toggleMethod('cash') },
                { label: 'Tarjeta', active: methodFilter === 'card', onClick: () => toggleMethod('card') },
            ]
        },
        {
            label: 'Importe',
            active: onlyPositive,
            options: [
                { label: '> 0 €', active: onlyPositive, onClick: toggleOnlyPositive },
            ]
        },
    ];

    const hasActiveFilters = paidFilter || invoiceTypeFilter || methodFilter || onlyPositive || invoiceUnpaidFilter;

    return (<div>
        <PageToolbar
            title="Ventas"
            filters={viewMode === 'pedido' ? toolbarFilters : []}
            actions={
                <>
                    {viewMode === 'pedido' && hasActiveFilters && (
                        <button className="uk-button uk-button-small uk-button-default" onClick={clearFilters} type="button">
                            Limpiar filtros
                        </button>
                    )}
                </>
            }
        />

        {/* Vista: por pedido (fecha de creación) vs por cobro (fecha real de dinero recibido) */}
        <div className="uk-button-group" style={{marginBottom: 12}}>
            <button
                type="button"
                className={`uk-button uk-button-small ${viewMode === 'pedido' ? 'uk-button-primary' : 'uk-button-default'}`}
                onClick={() => handleViewModeChange('pedido')}
            >
                Por fecha de pedido
            </button>
            <button
                type="button"
                className={`uk-button uk-button-small ${viewMode === 'cobro' ? 'uk-button-primary' : 'uk-button-default'}`}
                onClick={() => handleViewModeChange('cobro')}
                title="Ingresos por fecha real de cobro (Payment.createdAt) — para gestoría"
            >
                Por fecha de cobro
            </button>
            <button
                type="button"
                className={`uk-button uk-button-small ${viewMode === 'facturas' ? 'uk-button-primary' : 'uk-button-default'}`}
                onClick={() => handleViewModeChange('facturas')}
                title="Listado simple de facturas emitidas en el rango, por número"
            >
                Facturas
            </button>
        </div>

        {/* KPIs */}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16}}>
            {(viewMode === 'pedido' ? [
                {label: 'Total', value: formatEUR(totalVentas)},
                {label: 'Pedidos', value: cantidadPedidos},
                {label: 'Pendientes', value: pedidosPendientes},
                {label: 'Facturados', value: pedidosFacturados},
                {label: 'Sin cobrar', value: formatEUR(totalSinCobrar), sub: `${facturasSinCobrar.length} facturas`, accent: totalSinCobrar > 0},
            ] : viewMode === 'facturas' ? [
                {label: 'Total facturado', value: formatEUR(totalFacturasGross)},
                {label: 'Base imponible', value: formatEUR(totalFacturasNet)},
                {label: 'IVA', value: formatEUR(totalFacturasTax)},
                {label: 'Nº facturas', value: invoicesList.length},
            ] : [
                {label: 'Total', value: formatEUR(totalIngresos)},
                {label: 'Sin efectivo', value: formatEUR(totalIngresosSinEfectivo), sub: 'tarjeta, stripe, transferencia'},
                {label: 'Efectivo', value: formatEUR(totalIngresosEfectivo)},
                {label: 'Nº registros', value: incomePayments.length},
                {label: 'Sin pago registrado', value: formatEUR(totalFacturasHuerfanas), sub: `${facturasHuerfanas.length} facturas`, accent: facturasHuerfanas.length > 0},
            ]).map((kpi, i) => (
                <div key={i} className="uk-card uk-card-default uk-card-body uk-text-center"
                     style={{padding: '14px 10px', borderTop: kpi.accent ? '3px solid #ef4444' : undefined}}>
                    <div style={{fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase'}}>{kpi.label}</div>
                    <div style={{fontSize: '1.25rem', fontWeight: 700, marginTop: 2}}>{kpi.value}</div>
                    {kpi.sub && <div style={{fontSize: '0.7rem', color: '#94a3b8'}}>{kpi.sub}</div>}
                </div>
            ))}
        </div>

        <div className="uk-card uk-card-default uk-card-body">
            <DateRangeSelector
                from={fechaInicio}
                to={fechaFin}
                onChange={({ from, to }) => {
                    setFechaInicio(from);
                    setFechaFin(to);
                    localStorage.setItem('ventas_fechaInicio', from);
                    localStorage.setItem('ventas_fechaFin', to);
                }}
            />
            <div style={{display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10}}>
                <div style={{flex: 1}}></div>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 4}}>
                    {viewMode === 'pedido' && selectedOrders.length > 0 && (
                        <>
                            <button className="uk-button uk-button-small uk-button-primary" onClick={handleGenerateInvoices} disabled={loading} type="button">
                                Facturar todos
                            </button>
                            <button className="uk-button uk-button-small uk-button-default" onClick={() => setShowBatchCollect(prev => !prev)} disabled={loading} type="button">
                                Cobrar seleccionados
                            </button>
                        </>
                    )}
                    {viewMode === 'pedido' && (
                        <button className="uk-button uk-button-small uk-button-default" onClick={exportVentasXLSX} disabled={loading || ventasFiltradas.length === 0} type="button">
                            Exportar XLSX
                        </button>
                    )}
                    {viewMode === 'cobro' && (
                        <button className="uk-button uk-button-small uk-button-default" onClick={exportIngresosXLSX} disabled={incomeLoading || incomePayments.length === 0} type="button">
                            Exportar XLSX
                        </button>
                    )}
                    {viewMode === 'facturas' && (
                        <button className="uk-button uk-button-small uk-button-default" onClick={exportFacturasXLSX} disabled={invoicesLoading || invoicesList.length === 0} type="button">
                            Exportar XLSX
                        </button>
                    )}
                </div>
            </div>

            {viewMode === 'pedido' && showBatchCollect && selectedOrders.length > 0 && (
                <div style={{
                    background: '#f8f8f8',
                    border: '1px solid #e5e5e5',
                    borderRadius: 4,
                    padding: '12px 16px',
                    margin: '12px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap'
                }}>
                    <strong>Método de cobro:</strong>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="radio" name="batch-collect" value="transfer"
                            checked={collectMethod === 'transfer'}
                            onChange={() => setCollectMethod('transfer')} />
                        Transferencia
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="radio" name="batch-collect" value="cash"
                            checked={collectMethod === 'cash'}
                            onChange={() => setCollectMethod('cash')} />
                        Efectivo
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="radio" name="batch-collect" value="card_pos"
                            checked={collectMethod === 'card_pos'}
                            onChange={() => setCollectMethod('card_pos')} />
                        Tarjeta
                    </label>
                    <button
                        className="uk-button uk-button-primary uk-button-small"
                        onClick={handleBatchCollect}
                        disabled={loading}
                        type="button"
                    >
                        {loading ? 'Procesando...' : 'Confirmar cobro'}
                    </button>
                    <button
                        className="uk-button uk-button-default uk-button-small"
                        onClick={() => setShowBatchCollect(false)}
                        type="button"
                    >
                        Cancelar
                    </button>
                </div>
            )}

            {viewMode === 'cobro' ? (
                incomeLoading ? (<div className="uk-text-center uk-margin">
                    <span className="uk-badge uk-badge-warning">Cargando cobros...</span>
                </div>) : incomePayments.length === 0 ? (<div className="uk-text-center uk-margin">
                    <span className="uk-badge uk-badge-muted">No hay cobros en el rango seleccionado.</span>
                </div>) : (
                    <>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 6 }}>
                            {incomePayments.length} registros, ordenados por fecha de devengo (cobro real, o emisión de factura si no hay cobro registrado)
                        </div>
                        <div className="uk-overflow-auto">
                            <table className="uk-table uk-table-divider uk-table-small" style={{minWidth: 700}}>
                                <thead>
                                <tr>
                                    <th>Nº</th>
                                    <th>Fecha de cobro</th>
                                    <th>Cliente</th>
                                    <th>Pedido</th>
                                    <th>Nº Factura</th>
                                    <th>Método</th>
                                    <th>Importe</th>
                                </tr>
                                </thead>
                                <tbody>
                                {incomePayments.map((p, i) => (
                                    <tr key={p.id} style={p.orphan ? {background: 'rgba(239, 68, 68, 0.08)'} : undefined}>
                                        <td>{i + 1}</td>
                                        <td>{p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-ES', {dateStyle: 'medium'}) : ''}</td>
                                        <td>{nombreCliente(p.client) || '—'}</td>
                                        <td>{p.orderLabel || p.order?.orderNum || '—'}</td>
                                        <td>{p.invoiceNumber || '—'}</td>
                                        <td>
                                            {p.orphan
                                                ? <span className="uk-badge uk-badge-danger" title="Factura emitida pero sin pago registrado">⚠ Sin pago registrado</span>
                                                : metodoLabel(p.method)}
                                        </td>
                                        <td>{formatEUR(Number(p.amount) || 0)}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )
            ) : viewMode === 'facturas' ? (
                invoicesLoading ? (<div className="uk-text-center uk-margin">
                    <span className="uk-badge uk-badge-warning">Cargando facturas...</span>
                </div>) : invoicesList.length === 0 ? (<div className="uk-text-center uk-margin">
                    <span className="uk-badge uk-badge-muted">No hay facturas en el rango seleccionado.</span>
                </div>) : (
                    <>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 6 }}>
                            {invoicesList.length} facturas, ordenadas por fecha de emisión
                        </div>
                        <div className="uk-overflow-auto">
                            <table className="uk-table uk-table-divider uk-table-small" style={{minWidth: 700}}>
                                <thead>
                                <tr>
                                    <th>Nº</th>
                                    <th>Nº Factura</th>
                                    <th>Tipo</th>
                                    <th>Fecha emisión</th>
                                    <th>Cliente</th>
                                    <th>Base imponible</th>
                                    <th>IVA</th>
                                    <th>Total</th>
                                </tr>
                                </thead>
                                <tbody>
                                {invoicesList.map((f, i) => (
                                    // Las rectificativas van en negativo: se marcan para que no se
                                    // confundan con una factura normal al revisar el listado.
                                    <tr key={f.id} style={f.isRectifying ? {background: '#fff5f5'} : undefined}>
                                        <td>{i + 1}</td>
                                        <td>{f.number || '—'}</td>
                                        <td>
                                            {f.isRectifying ? (
                                                <span className="uk-badge" style={{background: '#d32f2f'}}
                                                      title={f.invoices?.number ? `Rectifica a ${f.invoices.number}` : 'Rectificativa'}>
                                                    Rect. {f.invoices?.number || ''}
                                                </span>
                                            ) : (f.type === 'n' ? 'Normal' : 'Simplificada')}
                                        </td>
                                        <td>{f.issuedAt ? new Date(f.issuedAt).toLocaleDateString('es-ES', {dateStyle: 'medium'}) : ''}</td>
                                        <td>{nombreCliente(f.User) || '—'}</td>
                                        <td>{formatEUR(Number(f.totalNet) || 0)}</td>
                                        <td>{formatEUR(Number(f.totalTax) || 0)}</td>
                                        <td style={f.isRectifying ? {color: '#d32f2f', fontWeight: 600} : undefined}>
                                            {formatEUR(Number(f.totalGross) || 0)}
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )
            ) : loading ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-warning">Cargando ventas...</span>
            </div>) : ventasFiltradas.length === 0 ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-muted">No hay ventas en el rango seleccionado.</span>
            </div>) : (
                <>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 6 }}>
                        Mostrando {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, ventasFiltradas.length)} de {ventasFiltradas.length} ventas
                    </div>
                    <div className="uk-overflow-auto">
                    <table className="uk-table uk-table-divider uk-table-small" style={{minWidth: 700}}>
                        <thead>
                        <tr>
                            <th>
                                <input
                                    type="checkbox"
                                    checked={selectedOrders.length > 0 && ventasPaginadas.filter(v => canSelectOrder(v)).every(v => selectedOrders.includes(v.id))}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            const validIds = ventasPaginadas.filter(v => canSelectOrder(v)).map(v => v.id);
                                            setSelectedOrders(prev => [...new Set([...prev, ...validIds])]);
                                            if (validIds.length > 0 && !selectionCriteria) {
                                                const first = ventasPaginadas.find(v => v.id === validIds[0]);
                                                setSelectionCriteria({
                                                    clientId: first.client?.id,
                                                    paid: first.paid
                                                });
                                            }
                                        } else {
                                            const pageIds = new Set(ventasPaginadas.map(v => v.id));
                                            setSelectedOrders(prev => prev.filter(id => !pageIds.has(id)));
                                            if (selectedOrders.every(id => pageIds.has(id))) {
                                                setSelectionCriteria(null);
                                            }
                                        }
                                    }}
                                />
                            </th>
                            <th>Número</th>
                            <th>Fecha</th>
                            <th>Cliente</th>
                            <th>Total</th>
                            <th>Estado</th>
                            <th>Factura</th>
                            <th></th>
                        </tr>
                        </thead>
                        <tbody>
                        {ventasPaginadas.map((v) => (
                            <VentaRow
                                key={v.id}
                                venta={v}
                                token={token}
                                isSelected={selectedOrders.includes(v.id)}
                                canSelect={canSelectOrder(v)}
                                onSelect={handleSelectOrder}
                                onRefresh={refreshOrder}
                                onVerPedido={verPedido}
                                globalLoading={selectedOrders.length > 0}
                            />
                        ))}
                        </tbody>
                    </table>
                    </div>
                    {totalPages > 1 && (
                        <Pagination
                            meta={paginationMeta}
                            onPageChange={(p) => setPage(p - 1)}
                        />
                    )}
                </>
            )}
        </div>
    </div>);
}
