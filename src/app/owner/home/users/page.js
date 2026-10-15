'use client';

import React, { useState, useEffect } from 'react';
import { Button, Table, Form, Input, Select, Modal, message, Card, Popconfirm, Tag, Spin } from 'antd';
import { UserAddOutlined, EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useForm } from 'antd/lib/form/Form';

// ✨ NEW FIREBASE IMPORTS ✨
import { api } from '@/lib/client/api';
// !!! IMPORTANT: Replace this with the actual path to your initialized Firebase client



// ... (Your imports from above, including the NEW FIREBASE IMPORTS)

// --- Configuration ---
const { Option } = Select;
const roles = [
    { label: 'Super Admin', value: 'super_admin', color: 'red' },
    { label: 'Admin', value: 'admin', color: 'blue' },
    { label: 'Standard User', value: 'user', color: 'green' },
];

/**
 * Super Admin/Owner Management Page
 */
const OwnerPage = () => {
    const [isModalVisible, setIsModalVisible] = useState(false);
    // ⚠️ Initial state is an empty array now, as we fetch real data
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingKey, setEditingKey] = useState('');
    const [form] = useForm();

    const currentUser = { role: 'super_admin' };

    // ------------------------------------------------------------------
    // ## DATA FETCHING FROM FIRESTORE
    // ------------------------------------------------------------------

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const { trusts } = await api.get('/owner/trusts');
            const userList = trusts.map(t => ({
                key: t.id,
                uid: t.id,
                name: t.displayName,
                email: t.email,
                role: t.loginActive === false ? 'disabled' : 'admin',
                createdAt: t.createdAt ? new Date(t.createdAt).toLocaleDateString() : 'N/A',
            }));
            setData(userList);
        } catch (error) {
            console.error('Error fetching users:', error);
            message.error('Failed to load trusts.');
        } finally {
            setLoading(false);
        }
    };

    // Load data when the component mounts
    useEffect(() => {
        if (currentUser.role === 'super_admin') {
            fetchUsers();
        }
    }, []);

    // ------------------------------------------------------------------
    // ## CREATE USER HANDLER (Updated to use fetchUsers to refresh list)
    // ------------------------------------------------------------------

    const showModal = () => {
        setIsModalVisible(true);
    };

    const handleCancel = () => {
        setIsModalVisible(false);
        form.resetFields();
    };

    const onFinishCreateUser = async (values) => {
        setLoading(true);
        const { name, email, password, role } = values;

        try {
            // creates the trust and its admin login in one call
            await api.post('/owner/trusts', { displayName: name, email, password });
            message.success(`User ${name} created successfully!`);
            await fetchUsers();
            handleCancel();
        } catch (error) {
            console.error('Operation Error:', error);
            message.error(`Creation failed: ${error.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    // ------------------------------------------------------------------
    // ## TABLE OPERATIONS (UPDATE & DELETE)
    // ------------------------------------------------------------------

    const isEditing = (record) => record.key === editingKey;

    const edit = (record) => {
        form.setFieldsValue({
            name: '',
            email: '',
            role: '',
            ...record,
        });
        setEditingKey(record.key);
    };

    const cancelEdit = () => {
        setEditingKey('');
    };

    const save = async (key) => {
        try {
            const row = await form.validateFields();
            const userToUpdate = data.find((item) => key === item.key);

            if (userToUpdate) {
                setLoading(true);
                const updatedData = { ...userToUpdate, ...row };

                // 1. Update Firestore Document
                await api.patch(`/owner/trusts/${updatedData.uid}`, {
                    displayName: updatedData.name,
                    active: updatedData.role !== 'disabled',
                });

                message.success('User updated successfully!');
                setEditingKey('');
                await fetchUsers(); // Refresh data after update

            } else {
                message.error('User not found.');
            }
        } catch (errInfo) {
            console.log('Validate Failed:', errInfo);
            message.error('Failed to validate fields or save data.');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (uid) => {
        setLoading(true);

        try {
            // the trust's admin login is disabled; its data is kept
            await api.del(`/owner/trusts/${uid}`);
            message.success('Login disabled. Trust data is kept.');
            await fetchUsers(); // Refresh data after deletion

        } catch (error) {
            console.error('Deletion Error:', error);
            message.error(`Deletion failed: ${error.message || 'Network error occurred.'}`);
        } finally {
            setLoading(false);
        }
    };

    // ------------------------------------------------------------------
    // ## TABLE COLUMNS & RENDER (Unchanged)
    // ------------------------------------------------------------------

    // ... (Your columns array remains the same)

    const columns = [
        // ... (Your columns definition here)
        {
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
            width: '20%',
            render: (text, record) => {
                const editable = isEditing(record);
                return editable ? (
                    <Form.Item name="name" rules={[{ required: true, message: 'Please input name!' }]} style={{ margin: 0 }}>
                        <Input />
                    </Form.Item>
                ) : (
                    text
                );
            },
        },
        {
            title: 'Email',
            dataIndex: 'email',
            key: 'email',
            width: '25%',
            render: (text, record) => {
                const editable = isEditing(record);
                return editable ? (
                    // Note: Email should ideally NOT be editable on the client side this way, 
                    // as changing it requires Firebase Auth logic. We keep it editable here 
                    // but the save function only updates name/role in Firestore.
                    <Form.Item
                        name="email"
                        rules={[
                            { required: true, message: 'Please input email!' },
                            { type: 'email', message: 'Not a valid email!' },
                        ]}
                        style={{ margin: 0 }}
                    >
                        <Input />
                    </Form.Item>
                ) : (
                    text
                );
            },
        },
        {
            title: 'Role',
            dataIndex: 'role',
            key: 'role',
            width: '15%',
            render: (role, record) => {
                const editable = isEditing(record);
                const roleConfig = roles.find(r => r.value === role) || { label: role, color: 'default' };

                return editable ? (
                    <Form.Item name="role" rules={[{ required: true, message: 'Please select a role!' }]} style={{ margin: 0 }}>
                        <Select>
                            {roles.map((r) => (
                                <Option key={r.value} value={r.value}>
                                    {r.label}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                ) : (
                    <Tag color={roleConfig.color} className="uppercase">
                        {roleConfig.label}
                    </Tag>
                );
            },
        },
        {
            title: 'Created At',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: '15%',
        },
        {
            title: 'Action',
            dataIndex: 'action',
            key: 'action',
            width: '25%',
            render: (_, record) => {
                const editable = isEditing(record);
                return editable ? (
                    <span className="flex gap-2">
                        <Button type="primary" icon={<SaveOutlined />} onClick={() => save(record.key)} className="bg-blue-500">
                            Save
                        </Button>
                        <Button icon={<CloseOutlined />} onClick={cancelEdit}>
                            Cancel
                        </Button>
                    </span>
                ) : (
                    <span className="flex gap-2">
                        <Button
                            disabled={editingKey !== ''}
                            onClick={() => edit(record)}
                            icon={<EditOutlined />}
                            className="text-blue-500 border-blue-500 hover:bg-blue-50"
                        >
                            Edit
                        </Button>
                        <Popconfirm
                            title="Sure to delete?"
                            onConfirm={() => handleDelete(record.uid)}
                            disabled={editingKey !== ''}
                        >
                            <Button danger icon={<DeleteOutlined />} disabled={editingKey !== ''}>
                                Delete
                            </Button>
                        </Popconfirm>
                    </span>
                );
            },
        },
    ];


    // --- Authorization Check & Main Render (Unchanged) ---
    // ... (rest of the component's authorization check and JSX render structure remains the same)

    if (currentUser.role !== 'super_admin') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <Card className="shadow-lg text-center p-8 bg-white max-w-md w-full">
                    <h2 className="text-2xl font-bold text-red-600 mb-4">Access Denied!</h2>
                    <p className="text-gray-600">You do not have the required 'super_admin' permissions to view this page.</p>
                </Card>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50">
            <header className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">🔑 Super Admin User Management</h1>
                <Button
                    type="primary"
                    icon={<UserAddOutlined />}
                    size="large"
                    onClick={showModal}
                    className="bg-green-600 hover:bg-green-700 transition duration-150"
                >
                    Create New User
                </Button>
            </header>

            <div className="bg-white p-6 rounded-lg shadow-xl">
                <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-gray-700">Existing Users</h2>
                <Spin spinning={loading} tip="Processing...">
                    <Form form={form} component={false}>
                        <Table
                            dataSource={data}
                            columns={columns}
                            rowKey="key" // Specify rowKey for Antd table
                            rowClassName="editable-row"
                            pagination={{
                                onChange: cancelEdit,
                                pageSize: 10,
                            }}
                            className="w-full"
                            scroll={{ x: 800 }}
                        />
                    </Form>
                </Spin>
            </div>

            {/* --- Create User Modal (Unchanged) --- */}
            <Modal
                title={
                    <div className="flex items-center gap-2">
                        <UserAddOutlined className="text-green-600" />
                        Create New Admin/User Account
                    </div>
                }
                open={isModalVisible}
                onCancel={handleCancel}
                footer={null}
            >
                <Form
                    form={form}
                    name="create_user_form"
                    onFinish={onFinishCreateUser}
                    layout="vertical"
                    className="mt-4"
                >
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[{ required: true, message: 'Please input the user\'s name!' }]}
                    >
                        <Input placeholder="Enter full name" />
                    </Form.Item>

                    <Form.Item
                        name="email"
                        label="Email"
                        rules={[
                            { required: true, message: 'Please input the user\'s email!' },
                            { type: 'email', message: 'The input is not a valid email!' },
                        ]}
                    >
                        <Input placeholder="Enter email address" />
                    </Form.Item>

                    <Form.Item
                        name="password"
                        label="Password"
                        rules={[
                            { required: true, message: 'Please input the password!' },
                            { min: 6, message: 'Password must be at least 6 characters.' },
                        ]}
                        hasFeedback
                    >
                        <Input.Password placeholder="Enter password (min 6 chars)" />
                    </Form.Item>

                    <Form.Item
                        name="role"
                        label="Role"
                        rules={[{ required: true, message: 'Please select a user role!' }]}
                    >
                        <Select placeholder="Select a role">
                            {roles.map((role) => (
                                <Option key={role.value} value={role.value}>
                                    {role.label}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={loading}
                            className="w-full bg-green-600 hover:bg-green-700 mt-4"
                            size="large"
                        >
                            Create Account
                        </Button>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default OwnerPage;