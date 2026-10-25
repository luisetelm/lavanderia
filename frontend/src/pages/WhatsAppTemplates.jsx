import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageToolbar from '../components/PageToolbar.jsx';
import { confirmar, avisar } from '../utils/dialogo.js';
import {
    fetchAllWhatsAppTemplates,
    createWhatsAppTemplate,
    editWhatsAppTemplate,
    deleteWhatsAppTemplate,
} from '../api.js';

// Plantillas de WhatsApp (/campanas/plantillas, solo admin): ver su estado en Meta,
// crear, editar el texto y borrar. Las reglas viven en backend/src/utils/plantillasWhatsApp.js.

const ESTADOS = {
    APPROVED: { texto: 'Aprobada', color: 'var(--tyb-success)', fondo: 'var(--tyb-success-soft)' },
    PENDING: { texto: 'En revisión', color: 'var(--tyb-warning)', fondo: 'var(--tyb-warning-soft)' },
    IN_APPEAL: { texto: 'Recurrida', color: 'var(--tyb-warning)', fondo: 'var(--tyb-warning-soft)' },
    REJECTED: { texto: 'Rechazada', color: 'var(--tyb-danger)', fondo: 'var(--tyb-danger-soft)' },
    PAUSED: { texto: 'Pausada', color: 'var(--tyb-danger)', fondo: 'var(--tyb-danger-soft)' },
    DISABLED: { texto: 'Desactivada', color: 'var(--tyb-danger)', fondo: 'var(--tyb-danger-soft)' },
    PENDING_DELETION: { texto: 'Borrándose', color: 'var(--tyb-text-muted)', fondo: 'var(--tyb-surface-muted)' },
};

const CATEGORIAS = { MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación' };

// Motivos de rechazo que devuelve Meta
const MOTIVOS = {
    INVALID_FORMAT: 'formato no válido',
    ABUSIVE_CONTENT: 'contenido no permitido',
    INCORRECT_CATEGORY: 'la categoría no corresponde al texto',
    PROMOTIONAL: 'es promocional: tiene que ir como Marketing',
    TAG_CONTENT_MISMATCH: 'la categoría no corresponde al texto',
    SCAM: 'parece un fraude',
};

const EJEMPLOS = { 1: 'Ana', 2: 'P-1234' };

const cuerpoDe = (t) => t.components?.find(c => c.type === 'BODY')?.text || '';
const cabeceraDe = (t) => t.components?.find(c => c.type === 'HEADER');
const botonesDe = (t) => t.components?.find(c => c.type === 'BUTTONS')?.buttons || [];

// Nombre válido para Meta: minúsculas sin acentos, números y guiones bajos
const limpiarNombre = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

// Pinta el texto como lo ve el cliente: variables con un ejemplo y *negrita*, _cursiva_, ~tachado~
function TextoWhatsApp({ texto }) {
    const conEjemplos = texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => EJEMPLOS[n] || `{{${n}}}`);
    const trozos = conEjemplos.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
    return (
        <>
            {trozos.map((t, i) => {
                if (/^\*.+\*$/.test(t)) return <strong key={i}>{t.slice(1, -1)}</strong>;
                if (/^_.+_$/.test(t)) return <em key={i}>{t.slice(1, -1)}</em>;
                if (/^~.+~$/.test(t)) return <s key={i}>{t.slice(1, -1)}</s>;
                return <React.Fragment key={i}>{t}</React.Fragment>;
            })}
        </>
    );
}

function Burbuja({ plantilla, texto }) {
    const cabecera = plantilla && cabeceraDe(plantilla);
    const botones = plantilla ? botonesDe(plantilla) : [];
    return (
        <div style={{
            background: '#e7f8dc', color: 'var(--tyb-text)', borderRadius: 'var(--tyb-radius-lg)',
            padding: '10px 12px', fontSize: '0.9rem', lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            maxWidth: 420, boxShadow: 'var(--tyb-shadow-sm)',
        }}>
            {cabecera && cabecera.format !== 'TEXT' && (
                <div style={{
                    background: 'var(--tyb-surface-muted)', borderRadius: 'var(--tyb-radius-md)', padding: 8,
                    marginBottom: 8, fontSize: '0.78rem', color: 'var(--tyb-text-muted)', textAlign: 'center',
                }}>
                    {cabecera.format === 'IMAGE' ? 'Imagen de cabecera' : 'Archivo de cabecera'}
                </div>
            )}
            {cabecera?.format === 'TEXT' && <strong style={{ display: 'block', marginBottom: 4 }}>{cabecera.text}</strong>}
            {texto ? <TextoWhatsApp texto={texto}/> : <span style={{ color: 'var(--tyb-text-muted)' }}>Escribe el texto…</span>}
            {botones.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8, paddingTop: 6 }}>
                    {botones.map((b, i) => (
                        <div key={i} style={{ color: 'var(--tyb-link)', textAlign: 'center', fontSize: '0.85rem' }}>{b.text}</div>
                    ))}
                </div>
            )}
        </div>
    );
}

function Etiqueta({ children, color, fondo }) {
    return (
        <span style={{
            background: fondo, color, fontSize: '0.72rem', fontWeight: 600,
            padding: '2px 8px', borderRadius: 'var(--tyb-radius-full)', whiteSpace: 'nowrap',
        }}>{children}</span>
    );
}

// Ventana para crear una plantilla o editar el texto de una existente
function Editor({ plantilla, onCerrar, onGuardar }) {
    const editando = !!plantilla;
    const [nombre, setNombre] = useState('');
    const [categoria, setCategoria] = useState('MARKETING');
    const [texto, setTexto] = useState(editando ? cuerpoDe(plantilla) : '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    const variables = useMemo(
        () => [...new Set([...texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => m[1]))].sort(),
        [texto],
    );

    const guardar = async () => {
        setGuardando(true);
        setError(null);
        try {
            await onGuardar({ nombre, categoria, texto: texto.trim() });
        } catch (err) {
            setError(err.error || err.message || 'No se pudo guardar');
            setGuardando(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={onCerrar}>
            <div style={{
                background: 'var(--tyb-surface)', borderRadius: 'var(--tyb-radius-lg)', padding: 20,
                maxWidth: 820, width: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--tyb-shadow-lg)',
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                        {editando ? `Editar ${plantilla.name}` : 'Nueva plantilla'}
                    </h3>
                    <button className="uk-icon-button" uk-icon="close" onClick={onCerrar} type="button"/>
                </div>

                <div className="uk-grid-small uk-child-width-1-1 uk-child-width-1-2@m" uk-grid="">
                    <div>
                        {!editando && (
                            <>
                                <label className="uk-form-label">Nombre</label>
                                <input className="uk-input" value={nombre} placeholder="horario_navidad"
                                       onChange={e => setNombre(limpiarNombre(e.target.value))}/>
                                <p style={{ fontSize: '0.75rem', color: 'var(--tyb-text-muted)', margin: '4px 0 10px' }}>
                                    Sólo lo veis vosotras. Minúsculas, números y guiones bajos; no se puede cambiar después.
                                </p>

                                <label className="uk-form-label">Categoría</label>
                                <select className="uk-select" value={categoria} onChange={e => setCategoria(e.target.value)}>
                                    <option value="MARKETING">Marketing: avisos generales, horarios, promociones</option>
                                    <option value="UTILITY">Utilidad: sobre un pedido concreto del cliente</option>
                                </select>
                                <p style={{ fontSize: '0.75rem', color: 'var(--tyb-text-muted)', margin: '4px 0 10px' }}>
                                    Las campañas usan Marketing. Si eliges Utilidad para algo que no es de un pedido, Meta la rechaza o la cambia.
                                </p>
                            </>
                        )}

                        <label className="uk-form-label">Texto</label>
                        <textarea className="uk-textarea" rows={9} value={texto}
                                  onChange={e => setTexto(e.target.value)}
                                  placeholder={'Hola {{1}}, …'}/>
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem',
                            color: texto.length > 1024 ? 'var(--tyb-danger)' : 'var(--tyb-text-muted)', marginTop: 4,
                        }}>
                            <span>{'{{1}}'} es el nombre del cliente. *negrita*, _cursiva_</span>
                            <span>{texto.length} / 1024</span>
                        </div>
                        {variables.length > 1 && !editando && (
                            <p style={{ fontSize: '0.75rem', color: 'var(--tyb-warning)', margin: '6px 0 0' }}>
                                Las campañas sólo rellenan {'{{1}}'}; con más variables no se podrá usar en una campaña.
                            </p>
                        )}
                        {editando && plantilla.usedBy && (
                            <p style={{ fontSize: '0.75rem', color: 'var(--tyb-text-muted)', margin: '6px 0 0' }}>
                                La app la usa: {plantilla.usedBy}. Mantén esas variables.
                            </p>
                        )}
                        {editando && (
                            <p style={{ fontSize: '0.75rem', color: 'var(--tyb-text-muted)', margin: '6px 0 0' }}>
                                Al guardar vuelve a revisión de Meta. Una aprobada sólo se puede editar una vez al día.
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="uk-form-label">Así le llega al cliente</label>
                        <div style={{ background: '#efeae2', borderRadius: 'var(--tyb-radius-lg)', padding: 16, minHeight: 200 }}>
                            <Burbuja plantilla={plantilla} texto={texto}/>
                        </div>
                    </div>
                </div>

                {error && <div className="uk-alert uk-alert-danger" style={{ marginTop: 12 }}>{error}</div>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                    <button className="uk-button uk-button-default" onClick={onCerrar} type="button">Cancelar</button>
                    <button className="uk-button uk-button-primary" onClick={guardar} type="button"
                            disabled={guardando || !texto.trim() || (!editando && !nombre)}>
                        {guardando ? 'Enviando a Meta…' : editando ? 'Guardar y mandar a revisión' : 'Crear y mandar a revisión'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function WhatsAppTemplates({ token }) {
    const [plantillas, setPlantillas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [editor, setEditor] = useState(null); // null | 'nueva' | plantilla

    const cargar = useCallback(async () => {
        try {
            const res = await fetchAllWhatsAppTemplates(token);
            setPlantillas(Array.isArray(res) ? res : []);
            setError(null);
        } catch (err) {
            setError(err.error || 'No se pudieron leer las plantillas de Meta');
        } finally {
            setCargando(false);
        }
    }, [token]);

    useEffect(() => { cargar(); }, [cargar]);

    // Mientras alguna esté en revisión, se mira cada 30 s si Meta ya ha contestado
    useEffect(() => {
        if (!plantillas.some(p => p.status === 'PENDING')) return;
        const t = setInterval(cargar, 30000);
        return () => clearInterval(t);
    }, [plantillas, cargar]);

    const guardar = async ({ nombre, categoria, texto }) => {
        if (editor === 'nueva') {
            await createWhatsAppTemplate(token, { name: nombre, category: categoria, text: texto });
            avisar('Plantilla creada. Meta la está revisando.', 'success');
        } else {
            await editWhatsAppTemplate(token, editor.id, texto);
            avisar('Texto cambiado. Meta lo está revisando.', 'success');
        }
        setEditor(null);
        await cargar();
    };

    const borrar = async (p) => {
        const ok = await confirmar(
            `¿Borrar la plantilla "${p.name}"? Se borra en Meta y no se puede deshacer; ese nombre no se podrá volver a usar durante un mes.`,
            { peligroso: true, textoConfirmar: 'Borrar' },
        );
        if (!ok) return;
        try {
            await deleteWhatsAppTemplate(token, p.name);
            avisar('Plantilla borrada', 'success');
            await cargar();
        } catch (err) {
            avisar(err.error || 'No se pudo borrar', 'danger');
        }
    };

    const ordenadas = useMemo(
        () => [...plantillas].sort((a, b) => (b.usedBy ? 1 : 0) - (a.usedBy ? 1 : 0) || a.name.localeCompare(b.name)),
        [plantillas],
    );

    return (
        <div className="page-container" style={{ padding: '0 16px 40px' }}>
            <PageToolbar
                title="Plantillas de WhatsApp"
                actions={
                    <>
                        <Link to="/campanas" className="uk-button uk-button-default uk-button-small">Campañas</Link>
                        <button className="uk-button uk-button-primary uk-button-small" type="button"
                                onClick={() => setEditor('nueva')}>
                            Nueva plantilla
                        </button>
                    </>
                }
            />

            <p style={{ fontSize: '0.85rem', color: 'var(--tyb-text-muted)', maxWidth: 760 }}>
                Para escribir a un cliente que no os ha escrito en las últimas 24 horas, WhatsApp sólo deja mandar
                plantillas aprobadas por Meta. Al crear o cambiar una, Meta la revisa: suele tardar de unos minutos a unas horas.
            </p>

            {cargando && <div style={{ padding: 40, textAlign: 'center' }}><span uk-spinner=""></span></div>}
            {error && <div className="uk-alert uk-alert-danger">{error}</div>}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
                {ordenadas.map(p => {
                    const estado = ESTADOS[p.status] || { texto: p.status, color: 'var(--tyb-text-muted)', fondo: 'var(--tyb-surface-muted)' };
                    const cabecera = cabeceraDe(p);
                    const conArchivo = cabecera && cabecera.format !== 'TEXT';
                    return (
                        <div key={p.id} className="uk-card uk-card-default uk-card-body uk-card-small"
                             style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                                <strong style={{ wordBreak: 'break-word' }}>{p.name}</strong>
                                <Etiqueta color={estado.color} fondo={estado.fondo}>{estado.texto}</Etiqueta>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--tyb-text-muted)' }}>
                                <span>{CATEGORIAS[p.category] || p.category}</span>
                                <span>·</span>
                                <span>{p.language}</span>
                                {p.usedBy && (<><span>·</span><span>La usa la app</span></>)}
                            </div>
                            {p.usedBy && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--tyb-text-muted)' }}>{p.usedBy}</div>
                            )}
                            {p.status === 'REJECTED' && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--tyb-danger)' }}>
                                    Motivo: {MOTIVOS[p.rejectedReason] || p.rejectedReason || 'Meta no lo indica'}
                                </div>
                            )}
                            <div style={{ background: '#efeae2', borderRadius: 'var(--tyb-radius-md)', padding: 10, flex: 1 }}>
                                <Burbuja plantilla={p} texto={cuerpoDe(p)}/>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button className="uk-button uk-button-default uk-button-small" type="button"
                                        disabled={conArchivo || p.status === 'PENDING_DELETION'}
                                        title={conArchivo ? 'Lleva imagen o archivo en la cabecera: no se puede editar desde aquí' : undefined}
                                        onClick={() => setEditor(p)}>
                                    Editar texto
                                </button>
                                {!p.usedBy && (
                                    <button className="uk-button uk-button-danger uk-button-small" type="button"
                                            onClick={() => borrar(p)}>
                                        Borrar
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {editor && (
                <Editor
                    plantilla={editor === 'nueva' ? null : editor}
                    onCerrar={() => setEditor(null)}
                    onGuardar={guardar}
                />
            )}
        </div>
    );
}
