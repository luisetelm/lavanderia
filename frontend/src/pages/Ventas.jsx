// javascript
import React, {useCallback, useEffect, useState} from 'react';
import {
    fetchOrders,
    createInvoice,
    downloadInvoicePDF
} from '../api.js';
import {useNavigate} from 'react-router-dom';
import * as XLSX from 'xlsx';

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

    // Exportar ventas actuales a XLSX usando SheetJS
    const exportVentasXLSX = () => {
        if (!Array.isArray(ventas) || ventas.length === 0) {
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
            {key: 'invoiceNumbers', label: 'Números factura'},
            {key: 'invoiceIds', label: 'Invoice IDs'},
            {key: 'notes', label: 'Notas'},
            {key: 'clienteExtra', label: 'Cliente extra (raw)'}
        ];

        const rows = ventas.map(v => {
            const fecha = v.createdAt ? new Date(v.createdAt) : null;
            const fechaFormateada = fecha ? fecha.toLocaleDateString('es-ES', {dateStyle: 'medium'}) : '';
            const cliente = v.client?.denominacionSocial || (v.client?.firstName ? `${v.client.firstName} ${v.client.lastName || ''}` : v.cliente) || '';
            const clientEmail = v.client?.email || '';
            const invoiceIds = (Array.isArray(v.invoiceTickets) ? v.invoiceTickets.map(it => it.invoiceId || (it.invoices && it.invoices.id) || '') : []).filter(Boolean).join(';');
            const invoiceCount = Array.isArray(v.invoiceTickets) ? v.invoiceTickets.length : 0;
            // Extraer números de factura de forma segura (varias posibles rutas según backend)
            const invoiceNumbers = Array.isArray(v.invoiceTickets) ? v.invoiceTickets.map(it => {
                return it?.invoices?.number ?? it?.invoices?.id ?? it?.number ?? it?.invoiceNumber ?? '';
            }).filter(Boolean).join(';') : '';

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
                invoiceNumbers,
                invoiceIds,
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
            setVentas(prev =>
                prev.map(o => o.id === v.id
                    ? {
                        ...o,
                        facturado: true,
                        invoiceTickets: [
                            ...(o.invoiceTickets || []),
                            // usa lo que te devuelva el backend; aquí dejo un fallback
                            { invoiceId: resp?.invoiceId ?? resp?.id, invoices: { type: 'n', number: resp?.number } }
                        ]
                    }
                    : o
                )
            );            console.log('Ventas:', data);
        } catch (err) {
            console.error('Error al cargar ventas:', err);
        } finally {
            setLoading(false);
        }
    }, [fechaInicio, fechaFin]);

// Calcula KPIs
    const totalVentas = ventas.reduce((sum, v) => sum + (Number(v.total) || 0), 0);
    const cantidadPedidos = ventas.length;
    const pedidosPendientes = ventas.filter(v => !(v.paid === false)).length;
    const pedidosFacturados = ventas.filter(v => (v.facturado === true)).length;


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


    const canSelectOrder = (order) => {
        if (order.facturado) return false;
        if (!selectionCriteria) return true;
        return (
            order.client?.id === selectionCriteria.clientId &&
            order.paid === selectionCriteria.paid
        );
    };

    return (<div>
        <div className="section-header">
            <h2 className="uk-margin-remove">Ventas</h2>

            <div className="uk-button-group">
                <button
                    className="uk-button uk-button-default"
                    onClick={() => {
                        fetchVentas();
                    }}
                    type="button"
                >
                    Todos
                </button>
                <button
                    className="uk-button uk-button-default"
                    onClick={() => {
                        setVentas(ventas.filter(v => (v.paid === false)));
                    }}
                    type="button"
                >
                    Pendientes
                </button>
                <button
                    className="uk-button uk-button-default"
                    onClick={() => {
                        setVentas(ventas.filter(v => v.paid === true));
                    }}
                    type="button"
                >
                    Pagados
                </button>
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
            </form>

            {loading ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-warning">Cargando ventas...</span>
            </div>) : ventas.length === 0 ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-muted">No hay ventas en el rango seleccionado.</span>
            </div>) : (
                <>
                    {/* Botón Facturar todos */}
                    {selectedOrders.length > 0 && (
                        <button
                            className="uk-button uk-button-primary uk-margin-bottom"
                            onClick={handleGenerateInvoices}
                            disabled={loading}
                            type="button"
                        >
                            Facturar todos
                        </button>
                    )}
                    {/* Botón Exportar */}
                    <button
                        className="uk-button uk-button-default uk-margin-small-left uk-margin-bottom"
                        onClick={exportVentasXLSX}
                        disabled={loading || ventas.length === 0}
                        type="button"
                    >
                        Exportar
                    </button>
                    <table className="uk-table uk-table-divider uk-table-small">
                        <thead>
                        <tr>
                            <th>
                                <input
                                    type="checkbox"
                                    checked={selectedOrders.length > 0 && ventas.filter(v => canSelectOrder(v)).every(v => selectedOrders.includes(v.id))}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            const validIds = ventas.filter(v => canSelectOrder(v)).map(v => v.id);
                                            setSelectedOrders(validIds);
                                            if (validIds.length > 0) {
                                                const first = ventas.find(v => v.id === validIds[0]);
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
                        {ventas.map((v) => {
                            const fecha = v.createdAt ? new Date(v.createdAt).toLocaleDateString('es-ES', {dateStyle: 'medium'}) : '-';
                            const cliente = v.client?.denominacionSocial || v.client?.firstName + ' ' + v.client.lastName || v.cliente || '-';
                            const total = typeof v.total === 'number' ? eur.format(v.total) : v.total ? eur.format(Number(v.total)) : '-';
                            const yaFacturado = v.invoiceTickets.length > 0;

                            return (<tr key={v.id} className={yaFacturado ? 'estado-facturado' : 'estado-pendiente'}>
                                <td>
                                    <input
                                        type="checkbox"
                                        checked={selectedOrders.includes(v.id)}
                                        disabled={!canSelectOrder(v)}
                                        onChange={() => handleSelectOrder(v)}
                                    />
                                </td>
                                <td>{v.orderNum}</td>
                                <td>{fecha}</td>
                                <td>{cliente}</td>
                                <td>{total}</td>
                                <td>
                            <span
                                className={`uk-badge ${yaFacturado ? 'uk-badge-success' : 'uk-badge-warning'}`}
                            >
                                {yaFacturado ? 'Facturado' : 'Pendiente'}
                            </span>
                                </td>
                                <td>
                                    {/* Manejo de facturas: sin factura, simplificada (type === 's') o normal (type === 'n') */}
                                    {v.invoiceTickets.length === 0 && (
                                        <div className="uk-button-group">

                                            <button
                                                className="uk-button uk-button-primary uk-button-small"
                                                onClick={async (e) => {
                                                    e?.preventDefault();
                                                    // Emitir factura normal (type 'n')
                                                    try {
                                                        setLoading(true);
                                                        const resp = await createInvoice(token, {
                                                            orderIds: [v.id],
                                                            type: 'n'
                                                        });
                                                        if (resp?.emailError) {
                                                            console.warn('Factura creada pero fallo envío de email:', resp.emailError);
                                                            alert('Factura creada, pero no se pudo enviar el email: ' + resp.emailError);
                                                        }
                                                        await fetchVentas();
                                                    } catch (err) {
                                                        console.error('Error al generar factura normal', err);
                                                        alert('No se pudo generar la factura normal: ' + (err.error || err.message || err));
                                                    } finally {
                                                        setLoading(false);
                                                    }
                                                }}
                                                disabled={loading || selectedOrders.length > 0}
                                                title="Emitir factura normal"
                                                type="button"
                                            >
                                                Normal
                                            </button>
                                        </div>
                                    )}

                                    {v.invoiceTickets.length > 0 && (() => {
                                        // Tomar la primera factura asociada
                                        const inv = v.invoiceTickets[0].invoices || v.invoiceTickets[0];
                                        const type = inv?.type || inv?.invoices?.type || null;
                                        if (type === 's') {
                                            // Factura simplificada: permitir convertir a normal y descargar
                                            return (
                                                <div className="uk-button-group">
                                                    <button
                                                        className="uk-button uk-button-warning uk-button-small"
                                                        onClick={async (e) => {
                                                            e?.preventDefault();
                                                            // Convertir a factura normal: emitimos una nueva factura tipo 'n' para el mismo ticket
                                                            try {
                                                                setLoading(true);
                                                                // Llamamos a createInvoice con el id del ticket/order. Se asume que el backend sabe convertir.
                                                                const resp = await createInvoice(token, {
                                                                    orderIds: [v.id],
                                                                    type: 'n'
                                                                });
                                                                if (resp?.emailError) {
                                                                    console.warn('Factura convertida pero fallo envío de email:', resp.emailError);
                                                                    alert('Factura convertida, pero no se pudo enviar el email: ' + resp.emailError);
                                                                }
                                                                await fetchVentas();
                                                            } catch (err) {
                                                                console.error('Error al convertir a factura normal', err);
                                                                alert('No se pudo convertir la factura a normal: ' + (err.error || err.message || err));
                                                            } finally {
                                                                setLoading(false);
                                                            }
                                                        }}
                                                        disabled={loading || selectedOrders.length > 0}
                                                        title="Convertir a factura normal"
                                                        type="button"
                                                    >
                                                        Convertir a normal
                                                    </button>
                                                    <button
                                                        className="uk-button uk-button-default uk-button-small"
                                                        onClick={(e) => { e?.preventDefault(); downloadInvoicePDF(token, v.invoiceTickets[0].invoiceId); }}
                                                        title="Ver factura"
                                                        type="button"
                                                    >
                                                        Descargar
                                                    </button>
                                                </div>
                                            );
                                        }
                                        // Si ya es normal, sólo descargar
                                        return (
                                            <button
                                                className="uk-button uk-button-default uk-button-small"
                                                onClick={(e) => { e?.preventDefault(); downloadInvoicePDF(token, v.invoiceTickets[0].invoiceId); }}
                                                title="Ver factura"
                                                type="button"
                                            >Descargar</button>
                                        );
                                    })()}
                                </td>
                                <td>
                                    <button
                                        className="uk-button uk-button-primary uk-button-small"
                                        onClick={() => verPedido(v)}
                                        title="Ver tareas de este pedido"
                                        type="button"
                                    >
                                        Ver pedido
                                    </button>
                                </td>
                            </tr>);
                        })}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    </div>);
}