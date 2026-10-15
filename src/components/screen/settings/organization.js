'use client'
// Settings → Organization. The single place where the trust's name, address, phone,
// logos, PDF header and receipt stamp are edited. Saving updates every screen and
// every PDF (open tabs reload it automatically).
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Upload, Button, Card, Progress, Divider, App, Radio, Alert, Tooltip } from 'antd';
import { FiImage, FiEdit2, FiInfo, FiUpload, FiPhone, FiMail, FiGlobe, FiMapPin, FiUser, FiAward, FiFileText, FiRotateCcw } from 'react-icons/fi';
import { useAuth } from '@/lib/AuthProvider';
import { api } from "@/lib/client/api";
import { saveTrustProfile } from "@/lib/client/trust";
import { TRUST_DEFAULTS, normalizeTrust } from "@/lib/trust/profile";
import { trustHeaderHtml } from "@/lib/trust/htmlHeader";

const { TextArea } = Input;

// kept for old imports: the built-in defaults
export const TrustData = TRUST_DEFAULTS;

const IMAGE_SLOTS = [
    { key: 'logo', label: 'Logo (left)', hint: 'Round emblem — PDF header, certificate, sidebar' },
    { key: 'RightLogo', label: 'Right Logo', hint: 'Right side of the PDF header (empty = same as logo)' },
    { key: 'stampImg', label: 'Stamp / Signature', hint: 'Printed on receipts (रसीद)' },
    { key: 'headerImg', label: 'Custom Header Picture', hint: 'Used only when "Header picture" is selected' },
    { key: 'banner', label: 'Banner', hint: 'Shown on this settings page' },
];

// ─── Info Row for display ─────────────────────────────────────────────────────
const InfoRow = ({ icon, label, value }) => {
    if (!value) return null;
    return (
        <div className="flex items-start gap-3 py-3 border-b last:border-0 border-[var(--gray-200)]">
            <span className="mt-0.5 text-[var(--primary-blue)] shrink-0">{icon}</span>
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gray-300)] mb-0.5">{label}</p>
                <p className="text-[var(--foreground)] text-sm leading-relaxed whitespace-pre-line">{value}</p>
            </div>
        </div>
    );
};

// ─── Image Preview ────────────────────────────────────────────────────────────
const ImagePreview = ({ src, alt }) => (
    <div className="w-full h-32 rounded-xl border-2 border-[var(--gray-200)] flex items-center justify-center bg-gray-50 overflow-hidden">
        {src
            ? <img src={src} alt={alt} className="max-w-full max-h-full object-contain" />
            : <span className="text-xs text-[var(--gray-300)]">Not set</span>}
    </div>
);

// ─── Upload Field with progress + reset ───────────────────────────────────────
const UploadField = ({ label, hint, value, isDefault, onChange }) => {
    const [progress, setProgress] = useState(null);
    const { message } = App.useApp();

    const handleUpload = async (file) => {
        if (!file.type.startsWith('image/')) { message.error('Only image files allowed!'); return false; }
        if (file.size / 1024 / 1024 > 2) { message.error('Image must be < 2MB!'); return false; }
        setProgress(10);
        try {
            const { url } = await api.upload(file, "trust");
            setProgress(100);
            onChange(url);
            message.success(`${label} uploaded!`);
        } catch (err) {
            message.error(`Failed to upload ${label}`);
            console.error(err);
        } finally {
            setProgress(null);
        }
        return false;
    };

    return (
        <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--gray-400)] mb-0">{label}</p>
            <p className="text-[11px] text-[var(--gray-300)] -mt-1">{hint}</p>
            <div className="w-full h-24 rounded-lg overflow-hidden border border-[var(--gray-200)] bg-gray-50 flex items-center justify-center">
                {value ? <img src={value} alt={label} className="w-full h-full object-contain" /> : <span className="text-xs text-[var(--gray-300)]">Not set</span>}
            </div>
            <div className="flex gap-2">
                <Upload listType="picture" maxCount={1} showUploadList={false} beforeUpload={handleUpload} className="flex-1">
                    <Button icon={<FiUpload />} size="small" className="w-full">{value ? 'Change' : 'Upload'}</Button>
                </Upload>
                {!isDefault && (
                    <Tooltip title="Remove">
                        <Button size="small" icon={<FiRotateCcw />} onClick={() => onChange(null)} />
                    </Tooltip>
                )}
            </div>
            {progress !== null && <Progress percent={progress} size="small" status={progress < 100 ? 'active' : 'success'} />}
        </div>
    );
};

// ─── Letterhead preview (same as the PDFs) ────────────────────────────────────
const HeaderPreview = ({ profile, height = 120 }) => {
    const html = useMemo(() => trustHeaderHtml(profile, { height }), [profile, height]);
    return (
        <div className="w-full overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-white p-3">
            <div style={{ minWidth: 560 }} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
};

const TEXT_KEYS = ['name', 'shortName', 'regNo', 'govtRegNo', 'cityState', 'address', 'about',
    'trustPresident', 'contactPerson', 'contact', 'email', 'website', 'founder', 'signatoryName', 'stampText'];

// ─── Main Component ───────────────────────────────────────────────────────────
const Organization = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form] = Form.useForm();
    const { user } = useAuth();
    const { message } = App.useApp();

    const [profile, setProfile] = useState(normalizeTrust({})); // what screens/PDFs use
    const [stored, setStored] = useState({});                   // what was actually saved
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [images, setImages] = useState({});                   // modal: image values being edited
    const [draft, setDraft] = useState(null);                   // modal: live preview profile

    const load = async () => {
        try {
            const { trust, profile: p } = await api.get("/trust");
            setStored(trust?.trustInfo || {});
            setProfile(p || normalizeTrust(trust?.trustInfo));
        } catch (err) {
            console.error(err);
        } finally {
            setFetching(false);
        }
    };

    useEffect(() => { if (user?.uid) load(); }, [user?.uid]);

    const handleEdit = () => {
        const v = {};
        for (const k of TEXT_KEYS) v[k] = profile[k] ?? '';
        if (profile.isDefault) v.name = '';   // make them type the real name
        v.topTitle = (profile.topTitle || []).join('\n');
        v.headerMode = profile.headerMode;
        form.setFieldsValue(v);
        const imgs = {};
        for (const s of IMAGE_SLOTS) imgs[s.key] = stored[s.key] || (s.key === 'stampImg' ? stored.trustStamp : null) || null;
        setImages(imgs);
        setDraft(profile);
        setIsModalOpen(true);
    };

    // rebuild the live preview from the form + images
    const recomputeDraft = (imgs = images) => {
        const v = form.getFieldsValue(true);
        setDraft(normalizeTrust({ ...stored, ...v, ...imgs }));
    };

    const handleSubmit = async (values) => {
        setLoading(true);
        try {
            const data = { ...values };
            for (const k of TEXT_KEYS) data[k] = (values[k] ?? '').toString();
            data.topTitle = (values.topTitle || '').split('\n').map(t => t.trim()).filter(Boolean);
            for (const s of IMAGE_SLOTS) data[s.key] = images[s.key] || null;
            await saveTrustProfile(data);
            await load();
            message.success('Saved — all screens and PDFs now use the new details');
            setIsModalOpen(false);
        } catch (err) {
            console.error(err);
            message.error("Failed to save: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const close = () => { setIsModalOpen(false); form.resetFields(); setImages({}); setDraft(null); };
    const topTitles = profile.topTitle || [];

    return (
        <div className="space-y-6">

            {/* ── Page Header ── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Organization Settings</h1>
                    <p className="text-[var(--gray-300)] mt-1">Trust details used on every screen, PDF, receipt and certificate</p>
                </div>
                <Button type="primary" size="large" icon={<FiEdit2 className="mr-2" />} onClick={handleEdit}
                    loading={fetching || loading} className="bg-[var(--primary-blue)] hover:bg-[var(--primary-dark)]">
                    Edit Organization Info
                </Button>
            </div>

            {!fetching && profile.isDefault && (
                <Alert type="warning" showIcon
                    message="Trust details are not set yet"
                    description={'Login page, sidebar and all PDFs show "Trust Manager" until you fill in your trust name, address, phone and logo here.'}
                    action={<Button size="small" type="primary" onClick={handleEdit}>Fill details</Button>} />
            )}

            {/* ── PDF header as it prints ── */}
            <Card loading={fetching} className="shadow-sm"
                title={<span className="flex items-center gap-2 text-base font-semibold"><FiFileText className="text-[var(--primary-blue)]" /> PDF Header (as printed)</span>}
                extra={<span className="text-xs text-[var(--gray-300)]">{profile.headerMode === 'image' ? 'Header picture' : 'Made from trust details'}</span>}>
                <HeaderPreview profile={profile} />
            </Card>

            {/* ── Banner ── */}
            {profile.banner && (
                <div className="relative rounded-2xl overflow-hidden h-48 shadow-md">
                    <img src={profile.banner} alt="Banner" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    {topTitles.length > 0 && (
                        <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
                            {topTitles.map((t, i) => (
                                <span key={i} className="bg-white/20 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full border border-white/30">{t}</span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Trust Name Card ── */}
            <Card className="shadow-sm border-l-4 border-l-[var(--primary-blue)]" loading={fetching}>
                <div className="flex items-start gap-4">
                    {profile.logo && (
                        <div className="w-20 h-20 rounded-xl border-2 border-[var(--gray-200)] overflow-hidden shrink-0">
                            <img src={profile.logo} alt="Logo" className="w-full h-full object-contain bg-gray-50" />
                        </div>
                    )}
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-[var(--foreground)] leading-snug">{profile.name}</h2>
                        {profile.cityState && (
                            <p className="text-[var(--gray-300)] mt-1 flex items-center gap-1 text-sm"><FiMapPin size={13} /> {profile.cityState}</p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2">
                            {profile.regNo && (
                                <span className="inline-block bg-[var(--primary-blue)]/10 text-[var(--primary-blue)] text-xs font-semibold px-3 py-1 rounded-full">Reg. No: {profile.regNo}</span>
                            )}
                            {profile.shortName && (
                                <span className="inline-block bg-gray-100 text-gray-600 text-xs font-semibold px-3 py-1 rounded-full">Short name: {profile.shortName}</span>
                            )}
                        </div>
                    </div>
                </div>
                {profile.about && (
                    <>
                        <Divider className="my-4" />
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gray-300)] mb-2">About</p>
                        <p className="text-[var(--foreground)] text-sm leading-relaxed whitespace-pre-line">{profile.about}</p>
                    </>
                )}
            </Card>

            {/* ── Info Grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card loading={fetching}
                    title={<span className="flex items-center gap-2 text-base font-semibold"><FiInfo className="text-[var(--primary-blue)]" /> Basic Information</span>}
                    extra={<Button type="text" icon={<FiEdit2 />} onClick={handleEdit} className="text-[var(--primary-blue)]" />}
                    className="shadow-sm hover:shadow-md transition-shadow">
                    <InfoRow icon={<FiAward size={16} />} label="Registration No." value={profile.regNo} />
                    <InfoRow icon={<FiFileText size={16} />} label="Govt. Reg. No." value={profile.govtRegNo} />
                    <InfoRow icon={<FiMapPin size={16} />} label="City / State" value={profile.cityState} />
                    <InfoRow icon={<FiMapPin size={16} />} label="Address" value={profile.address} />
                    {topTitles.length > 0 && (
                        <div className="py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gray-300)] mb-2">Top Titles</p>
                            <div className="flex flex-wrap gap-2">
                                {topTitles.map((t, i) => (
                                    <span key={i} className="bg-[var(--primary-blue)]/10 text-[var(--primary-blue)] text-xs px-2 py-0.5 rounded-full">{t}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </Card>

                <Card loading={fetching}
                    title={<span className="flex items-center gap-2 text-base font-semibold"><FiUser className="text-[var(--primary-blue)]" /> Contact & Leadership</span>}
                    extra={<Button type="text" icon={<FiEdit2 />} onClick={handleEdit} className="text-[var(--primary-blue)]" />}
                    className="shadow-sm hover:shadow-md transition-shadow">
                    <InfoRow icon={<FiUser size={16} />} label="Trust President" value={profile.trustPresident} />
                    <InfoRow icon={<FiUser size={16} />} label="Contact Person" value={profile.contactPerson} />
                    <InfoRow icon={<FiPhone size={16} />} label="Phone Numbers" value={profile.contact} />
                    <InfoRow icon={<FiMail size={16} />} label="Email" value={profile.email} />
                    <InfoRow icon={<FiGlobe size={16} />} label="Website" value={profile.website} />
                </Card>

                <Card loading={fetching}
                    title={<span className="flex items-center gap-2 text-base font-semibold"><FiFileText className="text-[var(--primary-blue)]" /> Receipt (रसीद) Details</span>}
                    extra={<Button type="text" icon={<FiEdit2 />} onClick={handleEdit} className="text-[var(--primary-blue)]" />}
                    className="shadow-sm hover:shadow-md transition-shadow lg:col-span-2">
                    <InfoRow icon={<FiUser size={16} />} label="Founder line (संथापक)" value={profile.founder} />
                    <InfoRow icon={<FiUser size={16} />} label="Signatory name (when no stamp image)" value={profile.signatoryName} />
                    <InfoRow icon={<FiAward size={16} />} label="Stamp text (when no stamp image)" value={profile.stampText} />
                </Card>

                <Card loading={fetching}
                    title={<span className="flex items-center gap-2 text-base font-semibold"><FiImage className="text-[var(--primary-blue)]" /> Media Assets</span>}
                    extra={<Button type="text" icon={<FiEdit2 />} onClick={handleEdit} className="text-[var(--primary-blue)]" />}
                    className="shadow-sm hover:shadow-md transition-shadow lg:col-span-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                        {IMAGE_SLOTS.filter(s => s.key !== 'banner').map(s => (
                            <div className="space-y-2" key={s.key}>
                                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gray-300)]">{s.label}</p>
                                <ImagePreview src={profile[s.key]} alt={s.label} />
                                {!stored[s.key] && !(s.key === 'stampImg' && stored.trustStamp) && <p className="text-[11px] text-[var(--gray-300)]">Not uploaded</p>}
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            {/* ── Edit Modal ── */}
            <Modal
                title={<h3 className="text-xl font-semibold">Edit Organization Details</h3>}
                open={isModalOpen}
                onCancel={close}
                footer={null}
                width={900}
                destroyOnClose
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit} onValuesChange={() => recomputeDraft()} className="mt-4">
                    <div className="max-h-[68vh] overflow-y-auto px-1 space-y-4">

                        {/* Live header preview */}
                        {draft && (
                            <div className="bg-[var(--gray-50)] p-4 rounded-xl">
                                <h4 className="text-sm font-semibold text-[var(--gray-400)] mb-3 uppercase tracking-wide">PDF Header Preview</h4>
                                <HeaderPreview profile={draft} height={100} />
                                <Form.Item name="headerMode" className="mt-3 mb-0">
                                    <Radio.Group>
                                        <Radio value="auto">Make header from trust details (recommended — updates automatically)</Radio>
                                        <Radio value="image">Use a header picture</Radio>
                                    </Radio.Group>
                                </Form.Item>
                            </div>
                        )}

                        {/* Basic Info */}
                        <div className="bg-[var(--gray-50)] p-4 rounded-xl">
                            <h4 className="text-sm font-semibold text-[var(--gray-400)] mb-4 uppercase tracking-wide">Basic Information</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Form.Item label="Organization Name" name="name" className="sm:col-span-2" rules={[{ required: true, message: 'Required' }]}>
                                    <Input placeholder="Organization name" className="h-10" />
                                </Form.Item>
                                <Form.Item label="Short Name (sidebar, browser tab, app)" name="shortName">
                                    <Input placeholder="e.g. MGSF" className="h-10" maxLength={20} />
                                </Form.Item>
                                <Form.Item label="Registration Number" name="regNo">
                                    <Input placeholder="e.g. 11637" className="h-10" />
                                </Form.Item>
                                <Form.Item label="Govt. Registration Number" name="govtRegNo">
                                    <Input placeholder="Government reg no." className="h-10" />
                                </Form.Item>
                                <Form.Item label="City / State" name="cityState">
                                    <Input placeholder="e.g. राजस्थान-गुजरात" className="h-10" />
                                </Form.Item>
                                <Form.Item label="Address" name="address" className="sm:col-span-2">
                                    <TextArea rows={2} placeholder="Complete address" className="resize-none" />
                                </Form.Item>
                                <Form.Item label="Top Titles (one per line)" name="topTitle" className="sm:col-span-2">
                                    <TextArea rows={3} placeholder={"|| श्री गणेशाय नमः ||\n|| जय माताजी ||"} className="resize-none" />
                                </Form.Item>
                                <Form.Item label="About Organization" name="about" className="sm:col-span-2">
                                    <TextArea rows={3} placeholder="Mission, activities, history..." className="resize-none" />
                                </Form.Item>
                            </div>
                        </div>

                        {/* Contact */}
                        <div className="bg-[var(--gray-50)] p-4 rounded-xl">
                            <h4 className="text-sm font-semibold text-[var(--gray-400)] mb-4 uppercase tracking-wide">Contact & Leadership</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Form.Item label="Trust President" name="trustPresident"><Input className="h-10" /></Form.Item>
                                <Form.Item label="Contact Person" name="contactPerson"><Input className="h-10" /></Form.Item>
                                <Form.Item label="Phone Numbers" name="contact"><Input placeholder="9999999999 / 8888888888" className="h-10" /></Form.Item>
                                <Form.Item label="Email" name="email"><Input type="email" placeholder="email@example.com" className="h-10" /></Form.Item>
                                <Form.Item label="Website" name="website" className="sm:col-span-2"><Input placeholder="https://www.example.com" className="h-10" /></Form.Item>
                            </div>
                        </div>

                        {/* Receipt */}
                        <div className="bg-[var(--gray-50)] p-4 rounded-xl">
                            <h4 className="text-sm font-semibold text-[var(--gray-400)] mb-4 uppercase tracking-wide">Receipt (रसीद)</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Form.Item label="Founder line (संथापक : …)" name="founder" className="sm:col-span-2">
                                    <Input placeholder="नाम  मोबाइल नंबर" className="h-10" />
                                </Form.Item>
                                <Form.Item label="Signatory name (used when no stamp image)" name="signatoryName">
                                    <Input className="h-10" />
                                </Form.Item>
                                <Form.Item label="Stamp text (used when no stamp image)" name="stampText">
                                    <TextArea rows={3} className="resize-none" />
                                </Form.Item>
                            </div>
                        </div>

                        {/* Media */}
                        <div className="bg-[var(--gray-50)] p-4 rounded-xl">
                            <h4 className="text-sm font-semibold text-[var(--gray-400)] mb-1 uppercase tracking-wide">Images</h4>
                            <p className="text-xs text-[var(--gray-300)] mb-4">Max 2 MB each. ↺ removes the image.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                {IMAGE_SLOTS.map(s => (
                                    <UploadField
                                        key={s.key}
                                        label={s.label}
                                        hint={s.hint}
                                        value={images[s.key] || (draft ? draft[s.key] : null)}
                                        isDefault={!images[s.key]}
                                        onChange={(url) => {
                                            const next = { ...images, [s.key]: url };
                                            setImages(next);
                                            recomputeDraft(next);
                                        }}
                                    />
                                ))}
                            </div>
                            <Alert className="mt-4" type="info" showIcon
                                message="Logo, phone, address and name changes show up in every PDF and receipt right after saving." />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-[var(--gray-200)]">
                        <Button onClick={close}>Cancel</Button>
                        <Button type="primary" htmlType="submit" loading={loading} className="bg-[var(--primary-blue)] hover:bg-[var(--primary-dark)]">
                            Save Changes
                        </Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
};

export default Organization;
