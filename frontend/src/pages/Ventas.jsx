// javascript
import React, {useCallback, useEffect, useState} from 'react';
import {
    fetchOrders,
    createInvoice,
    fetchOrder
} from '../api.js';
import {useNavigate} from 'react-router-dom';
import * as XLSX from 'xlsx';
import VentaRow from '../components/VentaRow.jsx';

function getPrimerDiaMes() {
    const hoy = new Date();
    return hoy.toISOString().slice(0, 8) + '01';
}

function getUltimoDiaMes() {
    const hoy = new Date();
    const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    const year = ultimo.getFullYear();
    const month = String(ultimo.getMonth() + 1).padStart(2, '0');
    const day = String(ultimo.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}


const eur = new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR'});

export default function Ventas({token}) {
    const [fechaInicio, setFechaInicio] = useState(() => localStorage.getItem('ventas_fechaInicio') || getPrimerDiaMes());
    const [fechaFin, setFechaFin] = useState(() => localStorage.getItem('ventas_fechaFin') || getUltimoDiaMes());


    const [ventas, setVentas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedOrders, setSelectedOrders] = useState([]);
    const [selectionCriteria, setSelectionCriteria] = useState(null);

    // NUEVO: estado de filtros (mutuamente excluyentes por categoría)
    const [paidFilter, setPaidFilter] = useState(null); // 'paid' | 'unpaid' | null
    // Sustituimos el filtro de facturados/no facturados por tipo de factura: 's' simplificada | 'n' normal
    const [invoiceTypeFilter, setInvoiceTypeFilter] = useState(null); // 's' | 'n' | null
    const [methodFilter, setMethodFilter] = useState(null); // 'cash' | 'card' | null

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
            alert('No hay datos para exportar');
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
                totalFormatted: typeof v.total === 'number' ? eur.format(v.total) : (v.total ? eur.format(Number(v.total)) : ''),
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

    // Al cambiar las fechas
    const handleFechaInicio = (e) => {
        setFechaInicio(e.target.value);
        localStorage.setItem('ventas_fechaInicio', e.target.value);
    };
    const handleFechaFin = (e) => {
        setFechaFin(e.target.value);
        localStorage.setItem('ventas_fechaFin', e.target.value);
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
            return true;
        });
    };

    // Calcula KPIs sobre la lista filtrada
    const ventasFiltradas = getVentasFiltradas();
    const totalVentas = ventasFiltradas.reduce((sum, v) => sum + (Number(v.total) || 0), 0);
    const cantidadPedidos = ventasFiltradas.length;
    const pedidosPendientes = ventasFiltradas.filter(v => v.paid === false).length;
    const pedidosFacturados = ventasFiltradas.filter(v => isInvoiced(v)).length;


    useEffect(() => {
        fetchVentas();
    }, [fetchVentas]);

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
            alert(e.error || 'Error generando facturas');
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
    };

    // Clases de botón según activo/inactivo
    const btnCls = (active) => `uk-button ${active ? 'uk-button-primary' : 'uk-button-default'}`;

    return (<div>
        <div className="section-header">
            <h2 className="uk-margin-remove">Ventas</h2>

            <div className="uk-flex uk-flex-wrap uk-flex-middle uk-grid-small" uk-grid="true">
                <div>
                    <button
                        className={btnCls(!paidFilter && !invoiceTypeFilter && !methodFilter)}
                        onClick={() => clearFilters()}
                        type="button"
                    >
                        Todos
                    </button>
                </div>
                <div>
                    <div className="uk-button-group">
                        <button
                            className={btnCls(paidFilter === 'unpaid')}
                            onClick={() => togglePaid('unpaid')}
                            type="button"
                        >
                            Pendientes de cobro
                        </button>
                        <button
                            className={btnCls(paidFilter === 'paid')}
                            onClick={() => togglePaid('paid')}
                            type="button"
                        >
                            Cobrados
                        </button>
                    </div>
                </div>
                <div>
                    <div className="uk-button-group">
                        <button
                            className={btnCls(invoiceTypeFilter === 'sinfactura')}
                            onClick={() => toggleInvoiceType('sinfactura')}
                            type="button"
                        >
                            Sin Facturar
                        </button>
                        <button
                            className={btnCls(invoiceTypeFilter === 's')}
                            onClick={() => toggleInvoiceType('s')}
                            type="button"
                        >
                            F. Simplificadas
                        </button>
                        <button
                            className={btnCls(invoiceTypeFilter === 'n')}
                            onClick={() => toggleInvoiceType('n')}
                            type="button"
                        >
                            F. Normales
                        </button>
                    </div>
                </div>
                <div>
                    <div className="uk-button-group">
                        <button
                            className={btnCls(methodFilter === 'cash')}
                            onClick={() => toggleMethod('cash')}
                            type="button"
                        >
                            Efectivo
                        </button>
                        <button
                            className={btnCls(methodFilter === 'card')}
                            onClick={() => toggleMethod('card')}
                            type="button"
                        >
                            Tarjeta
                        </button>
                    </div>
                </div>
            </div>

        </div>
        <div className="uk-grid uk-padding uk-child-width-1-4 uk-grid-small uk-margin-bottom">
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Total</div>
                    <div className="uk-text-large">{eur.format(totalVentas)}</div>
                </div>
            </div>
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Pedidos</div>
                    <div className="uk-text-large">{cantidadPedidos}</div>
                </div>
            </div>
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Pendientes</div>
                    <div className="uk-text-large">{pedidosPendientes}</div>
                </div>
            </div>
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Facturados</div>
                    <div className="uk-text-large">{pedidosFacturados}</div>
                </div>
            </div>
        </div>
        <div className="uk-card uk-card-default uk-card-body">

            <form className="uk-form-stacked uk-grid-small uk-flex-middle" data-uk-grid="true">
                <div>
                    <label className="uk-form-label">Desde:</label>
                    <input
                        className="uk-input"
                        type="date"
                        value={fechaInicio}
                        onChange={handleFechaInicio}
                    />
                </div>
                <div>
                    <label className="uk-form-label">Hasta:</label>
                    <input
                        className="uk-input"
                        type="date"
                        value={fechaFin}
                        onChange={handleFechaFin}
                    />
                </div>
                <div className="uk-width-expand"></div>
                <div>
                    <label className="uk-form-label">&nbsp;</label>
                    <div className="uk-button-group">
                        {selectedOrders.length > 0 && (
                            <button
                                className="uk-button uk-button-primary"
                                onClick={handleGenerateInvoices}
                                disabled={loading}
                                type="button"
                            >
                                Facturar todos
                            </button>
                        )}
                        <button
                            className="uk-button uk-button-default"
                            onClick={exportVentasXLSX}
                            disabled={loading || ventasFiltradas.length === 0}
                            type="button"
                        >
                            Exportar XLSX
                        </button>
                    </div>
                </div>
            </form>

            {loading ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-warning">Cargando ventas...</span>
            </div>) : ventasFiltradas.length === 0 ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-muted">No hay ventas en el rango seleccionado.</span>
            </div>) : (
                <>
                    <table className="uk-table uk-table-divider uk-table-small">
                        <thead>
                        <tr>
                            <th>
                                <input
                                    type="checkbox"
                                    checked={selectedOrders.length > 0 && ventasFiltradas.filter(v => canSelectOrder(v)).every(v => selectedOrders.includes(v.id))}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            const validIds = ventasFiltradas.filter(v => canSelectOrder(v)).map(v => v.id);
                                            setSelectedOrders(validIds);
                                            if (validIds.length > 0) {
                                                const first = ventasFiltradas.find(v => v.id === validIds[0]);
                                                setSelectionCriteria({
                                                    clientId: first.client?.id,
                                                    paid: first.paid
                                                });
                                            }
                                        } else {
                                            setSelectedOrders([]);
                                            setSelectionCriteria(null);
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
                        {ventasFiltradas.map((v) => (
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
                </>
            )}
        </div>
    </div>);
}
