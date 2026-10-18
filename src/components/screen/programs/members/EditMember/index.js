"use client";
import React, { useState, useEffect } from 'react';
import DuplicateWarning from '@/components/common/DuplicateWarning';
import { Button, Drawer, Select, Form, Input, DatePicker, Upload, Card, Row, Col, Divider, Space, Typography, App, Spin, Checkbox, AutoComplete } from 'antd';
import {
  EditOutlined,
  UserOutlined,
  PhoneOutlined,
  IdcardOutlined,
  HomeOutlined,
  UploadOutlined,
  CameraOutlined,
  DeleteOutlined,
  TagOutlined,
  LoadingOutlined,
  PlusOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import ImgCrop from 'antd-img-crop';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
// Services Imports
import { api } from '@/lib/client/api';
import { uploadFile } from '@/lib/services/storageService';
import { useAuth } from '@/lib/AuthProvider';
import { FixedLimitField } from '@/components/common/fixedLimit/FixedLimit';
import { gender } from '@/lib/staticData';
import { useMasterLists } from '@/lib/client/useMasterLists';

const { Option } = Select;
const { TextArea } = Input;
const { Title, Text } = Typography;


// Closing pay amount (किस्त): the age group's amount; a group set to ₹0 means this member pays nothing.
// No matching age group → program default (Add) / the member's current amount (Edit).
const defaultPayOf = (program) => Number(program?.defaultPayAmount) || 200;
const groupPay = (group, program) =>
  group && group.payAmount !== undefined && group.payAmount !== null && group.payAmount !== ''
    ? Math.max(0, Number(group.payAmount) || 0)
    : defaultPayOf(program);

const EditMember = ({ memberData, programId, onSuccess, setOpen, open }) => {
  // dropdown lists from Master Data (state, district, relation, caste, gotra)
  const { states, districtsByState, relations: guardianRelations, castes, gotras } = useMasterLists();
  const programList = useSelector((state) => state.data.programList || []);
  const agentsList = useSelector((state) => state.data.agentsList || []);
  const [form] = Form.useForm();
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();
  const [addedBy, setAddedBy] = useState('admin');

  // Age and payment states
  const [selectedAgeGroup, setSelectedAgeGroup] = useState(null);
  const [payAmount, setPayAmount] = useState(0);
  // what is actually saved / shown
  const effectivePay = selectedAgeGroup ? groupPay(selectedAgeGroup, selectedProgram) : (memberData?.payAmount ?? defaultPayOf(selectedProgram));
  const [joinFees, setJoinFees] = useState(0);

  // Join Fees Payment states
  const [isJoinFeesDone, setIsJoinFeesDone] = useState(false);
  const [joinFeesPaymentType, setJoinFeesPaymentType] = useState(null);
  const [customJoinFeesAmount, setCustomJoinFeesAmount] = useState(0);

  // Location group
  const [selectedLocationGroup, setSelectedLocationGroup] = useState(null);
  const { user } = useAuth();

  // Dynamic guardian label based on program
  const isHaqdarProgram = selectedProgram?.isMamera;
  const guardianLabel = isHaqdarProgram ? "हक़दार" : "वारिसदार";

  // File uploads - Store actual File objects and existing URLs
  const [photo, setPhoto] = useState([]);
  const [extraPhoto, setExtraPhoto] = useState([]);
  const [documentFront, setDocumentFront] = useState([]);
  const [documentBack, setDocumentBack] = useState([]);
  const [guardianDocument, setGuardianDocument] = useState([]);
  const [guardianDocumentBack, setGuardianDocumentBack] = useState([]);

  // एप्लीकेशन नंबर — duplicate ALLOWED. यह सिर्फ़ चेतावनी दिखाने के लिए है,
  // save कहीं नहीं रुकता। Value string है (67A जैसे मान चलते हैं)।
  const checkApplicationNumberDuplicate = async (appNumber) => {
    try {
      const value = String(appNumber ?? '').trim();
      if (!value || !programId || !user?.uid) return false;
      const r = await api.get(`/programs/${programId}/members`, { q: value, pageSize: 50 });
      // Exclude current member from duplicate check
      return r.members.some(m => m.id !== memberData?.id && String(m.applicationNumber ?? '').trim() === value);
    } catch (error) {
      console.log("Duplicate check error:", error);
      return false;
    }
  };

  // Extra Dynamic Fields State
  const [extraFields, setExtraFields] = useState([]);

  const [districts, setDistricts] = useState([]);
  const [closingDays, setClosingDays] = useState(null);

  const getDecimalAge = (birthDate, joinDate) => {
    return dayjs(joinDate).diff(dayjs(birthDate), 'year', true);
  };

  const getJoinDate = (memberData) => {
    if (memberData?.dateJoin) {
      return dayjs(memberData.dateJoin, 'DD-MM-YYYY');
    }
    if (memberData?.requestCreatedAt?.seconds) {
      return dayjs(memberData.requestCreatedAt.seconds * 1000);
    }
    return dayjs();
  };

  // Initialize form with existing member data
  useEffect(() => {
    if (open && memberData) {
      // Find the program
      const program = programList.find(p => p.id === memberData.programId);
      setSelectedProgram(program);

      // Set districts based on state
      if (memberData.state) {
        setDistricts(districtsByState[memberData.state] || []);
      }

      // Get join date
      const dateJoin = memberData.dateJoin 
        ? dayjs(memberData.dateJoin, 'DD-MM-YYYY') 
        : (memberData.requestCreatedAt?.seconds 
          ? dayjs(memberData.requestCreatedAt.seconds * 1000) 
          : dayjs());

      // Calculate age and set age group
      if (program && memberData.bobDate) {
        const birthDate = dayjs(memberData.bobDate, 'DD-MM-YYYY');
        const decimalAge = getDecimalAge(birthDate, dateJoin);
        const age = Math.floor(decimalAge);

        const matchingGroup = program.ageGroups?.find(group =>
          decimalAge >= group.startAge &&
          decimalAge < group.endAge
        );

        if (matchingGroup) {
          setSelectedAgeGroup(matchingGroup);
          setPayAmount(matchingGroup.payAmount || 0);
          setJoinFees(matchingGroup.joinFee || 0);
        } else {  
          setSelectedAgeGroup(null);
          setPayAmount(0);
          setJoinFees(0);
        }
      }

      // Find location group
      if (program && memberData.locationGroup) {
        const locGroup = program.locationGroups?.find(g => 
          g.location === memberData.locationGroup || g.groupName === memberData.memberGroup
        );
        setSelectedLocationGroup(locGroup);
      }

      // Set extra fields
      if (memberData.extraDetails && Array.isArray(memberData.extraDetails)) {
        setExtraFields(memberData.extraDetails);
      }

      // Set Join Fees payment data
      const joinFeesDoneStatus = memberData?.joinFeesDone || false;
      setIsJoinFeesDone(joinFeesDoneStatus);
      
      if (joinFeesDoneStatus) {
        const paymentTypeValue = memberData?.joinFeesPaymentType || 'full';
        setJoinFeesPaymentType(paymentTypeValue);
        
        if (paymentTypeValue === 'custom') {
          const paidAmount = memberData?.joinFeesPaidAmount || 0;
          setCustomJoinFeesAmount(paidAmount);
        } else if (paymentTypeValue === 'full') {
          const fullAmount = memberData?.joinFees || 0;
          setCustomJoinFeesAmount(fullAmount);
        }
      } else {
        setJoinFeesPaymentType(null);
        setCustomJoinFeesAmount(0);
      }

      // Set existing images as file list items
      if (memberData.photoURL) {
        setPhoto([{
          uid: '-1',
          name: 'photo.jpg',
          status: 'done',
          url: memberData.photoURL,
        }]);
      } else {
        setPhoto([]);
      }

      if (memberData.extraImageURL) {
        setExtraPhoto([{
          uid: '-2',
          name: 'extra.jpg',
          status: 'done',
          url: memberData.extraImageURL,
        }]);
      } else {
        setExtraPhoto([]);
      }

      if (memberData.documentFrontURL) {
        setDocumentFront([{
          uid: '-3',
          name: 'front.jpg',
          status: 'done',
          url: memberData.documentFrontURL,
        }]);
      } else {
        setDocumentFront([]);
      }

      if (memberData.documentBackURL) {
        setDocumentBack([{
          uid: '-4',
          name: 'back.jpg',
          status: 'done',
          url: memberData.documentBackURL,
        }]);
      } else {
        setDocumentBack([]);
      }

      if (memberData.guardianDocumentURL) {
        setGuardianDocument([{
          uid: '-5',
          name: 'guardian.jpg',
          status: 'done',
          url: memberData.guardianDocumentURL,
        }]);
      } else {
        setGuardianDocument([]);
      }

      if (memberData.guardianDocumentBackURL) {
        setGuardianDocumentBack([{
          uid: '-6',
          name: 'guardian_back.jpg',
          status: 'done',
          url: memberData.guardianDocumentBackURL,
        }]);
      } else {
        setGuardianDocumentBack([]);
      }
      
      setAddedBy(memberData.addedBy || 'admin');

      // Set form values
      const formValues = {
        displayName: memberData.displayName,
        fatherName: memberData.fatherName,
        guardian: memberData.guardian,
        guardianRelation: memberData.guardianRelation,
        gender: memberData.gender,
        gotra: memberData.gotra || '',
        jati: memberData.jati || '',
        phone: memberData.phone,
        phoneAlt: memberData.phoneAlt || '',
        aadhaarNo: memberData.aadhaarNo,
        guardianAadharNo: memberData.guardianAadharNo || '',
        applicationNumber: memberData.applicationNumber,
        bobDate: memberData.bobDate ? dayjs(memberData.bobDate, 'DD-MM-YYYY') : null,
        dateJoin: dateJoin,
        currentAddress: memberData.currentAddress,
        village: memberData.village,
        state: memberData.state,
        district: memberData.district,
        pinCode: memberData.pinCode,
        note: memberData.note || '',
        program: memberData.programId,
        ageGroup: memberData.ageGroup,
        closingMonths: memberData.closingMonths || 0,
        locationGroup: selectedLocationGroup?.id || undefined,
        addedBy: memberData.addedBy || 'admin',
        selectedAgent: memberData.agentId || undefined,
        joinFeesDone: joinFeesDoneStatus,
        joinFeesPaymentType: joinFeesPaymentType,
        joinFeesTxtId: memberData?.joinFeesTxtId || "",
        fixedLimit: memberData?.fixedLimit ?? null,
      };

      // Add custom join fees amount if applicable
      if (joinFeesDoneStatus && joinFeesPaymentType === 'custom') {
        formValues.customJoinFeesAmount = memberData?.joinFeesPaidAmount || 0;
      } else if (joinFeesDoneStatus && joinFeesPaymentType === 'full') {
        formValues.customJoinFeesAmount = memberData?.joinFees || 0;
      }

      form.setFieldsValue(formValues);
    }
  }, [open, memberData, programList, form, selectedLocationGroup]);

  // Reset form when drawer closes
  useEffect(() => {
    if (!open) {
      form.resetFields();
      setSelectedProgram(null);
      setPayAmount(0);
      setJoinFees(0);
      setSelectedAgeGroup(null);
      setSelectedLocationGroup(null);
      setPhoto([]);
      setExtraPhoto([]);
      setDocumentFront([]);
      setDocumentBack([]);
      setGuardianDocument([]);
      setExtraFields([]);
      setDistricts([]);
      setIsJoinFeesDone(false);
      setJoinFeesPaymentType(null);
      setCustomJoinFeesAmount(0);
    }
  }, [open, form]);

  // Handle state selection to update districts
  const handleStateSelect = (stateName) => {
    setDistricts(districtsByState[stateName] || []);
    form.setFieldsValue({ district: undefined });
  };

  // Calculate age and set age group
  const handleDateOfBirthChange = (date) => {
    if (!date || !selectedProgram) return;

    const joinDate = form.getFieldValue('dateJoin') || dayjs();
    const decimalAge = getDecimalAge(date, joinDate);
    const age = Math.floor(decimalAge);

    const matchingGroup = selectedProgram.ageGroups?.find(group =>
      decimalAge >= group.startAge &&
      decimalAge < group.endAge
    );

    if (matchingGroup) {
      setSelectedAgeGroup(matchingGroup);
      setPayAmount(matchingGroup.payAmount || 0);
      setJoinFees(matchingGroup.joinFee || 0);
      form.setFieldsValue({ ageGroup: matchingGroup.id });
      
      // Reset join fees payment if join fees amount changed
      if (isJoinFeesDone) {
        form.setFieldsValue({
          joinFeesPaymentType: undefined,
          customJoinFeesAmount: undefined
        });
        setJoinFeesPaymentType(null);
        setCustomJoinFeesAmount(0);
      }
    } else {
      message.warning(`उम्र ${age} इस कार्यक्रम के लिए किसी भी पात्र आयु समूह में नहीं आती है।`);
      form.setFieldsValue({
        bobDate: null,
        ageGroup: undefined
      });
      setSelectedAgeGroup(null);
      setPayAmount(0);
      setJoinFees(0);
    }
  };

  // Handle join date change
  const handleJoinDateChange = (date) => {
    if (!date || !selectedProgram) return;

    const birthDate = form.getFieldValue('bobDate');
    
    if (birthDate) {
      const decimalAge = getDecimalAge(birthDate, date);
      const age = Math.floor(decimalAge);

      const matchingGroup = selectedProgram.ageGroups?.find(group =>
        decimalAge >= group.startAge &&
        decimalAge < group.endAge
      );

      if (matchingGroup) {
        setSelectedAgeGroup(matchingGroup);
        setPayAmount(matchingGroup.payAmount || 0);
        setJoinFees(matchingGroup.joinFee || 0);
        form.setFieldsValue({ ageGroup: matchingGroup.id });
        
        // Reset join fees payment if join fees amount changed
        if (isJoinFeesDone) {
          form.setFieldsValue({
            joinFeesPaymentType: undefined,
            customJoinFeesAmount: undefined
          });
          setJoinFeesPaymentType(null);
          setCustomJoinFeesAmount(0);
        }
      } else {
        message.warning(`उम्र ${age} इस कार्यक्रम के लिए किसी भी पात्र आयु समूह में नहीं आती है।`);
        setSelectedAgeGroup(null);
        setPayAmount(0);
        setJoinFees(0);
        form.setFieldsValue({ ageGroup: undefined });
      }
    }
  };

  // Handle upload changes with cropping support
  const handleUploadChange = (setter) => ({ fileList }) => {
    const updatedFileList = fileList.map(file => {
      if (file.originFileObj instanceof File) {
        return {
          ...file,
          status: 'done',
          originFileObj: file.originFileObj,
          url: file.url || URL.createObjectURL(file.originFileObj)
        };
      }
      return file;
    });
    setter(updatedFileList.slice(-1));
  };

  // Preview uploaded files
  const onPreview = async (file) => {
    let src = file.url;
    if (!src && file.originFileObj) {
      src = await new Promise(resolve => {
        const reader = new FileReader();
        reader.readAsDataURL(file.originFileObj);
        reader.onload = () => resolve(reader.result);
      });
    }
    const imgWindow = window.open('', '_blank');
    if (imgWindow) {
      imgWindow.document.write(`<img src="${src}" style="max-width:100%; height:auto;">`);
    }
  };

  // Extra Dynamic Fields Handlers
  const handleAddExtraField = () => {
    setExtraFields([...extraFields, { label: '', value: '' }]);
  };

  const handleExtraFieldChange = (index, key, value) => {
    const newFields = [...extraFields];
    newFields[index][key] = value;
    setExtraFields(newFields);
  };

  const handleRemoveExtraField = (index) => {
    const newFields = extraFields.filter((_, i) => i !== index);
    setExtraFields(newFields);
  };

  const handleRemovePhoto = async (file) => {
    // the old file is kept on the server; saving the form stores the new URL
    return true;
  };

  // Form submission
  const onFinish = async (values) => {
    setLoading(true);
    console.log(values, 'values');

    try {
      // duplicate एप्लीकेशन नंबर अब मान्य है — यहाँ कोई रोक नहीं
      const updatedData = { ...memberData };

      // Handle file uploads - only upload new files
      const uploadPromises = [];

      // Photo
      if (photo.length && photo[0].originFileObj) {
        uploadPromises.push(
          uploadFile(`/users/${user.uid}/programs/${programId}/members`, photo[0].originFileObj)
            .then(result => { updatedData.photoURL = result.url; })
        );
      }

      // Extra Photo
      if (extraPhoto.length && extraPhoto[0].originFileObj) {
        uploadPromises.push(
          uploadFile(`/users/${user.uid}/programs/${programId}/members`, extraPhoto[0].originFileObj)
            .then(result => { updatedData.extraImageURL = result.url; })
        );
      } else if (!extraPhoto.length) {
        updatedData.extraImageURL = '';
      }

      // Document Front
      if (documentFront.length && documentFront[0].originFileObj) {
        uploadPromises.push(
          uploadFile(`/users/${user.uid}/programs/${programId}/members`, documentFront[0].originFileObj)
            .then(result => { updatedData.documentFrontURL = result.url; })
        );
      }

      // Document Back
      if (documentBack.length && documentBack[0].originFileObj) {
        uploadPromises.push(
          uploadFile(`/users/${user.uid}/programs/${programId}/members`, documentBack[0].originFileObj)
            .then(result => { updatedData.documentBackURL = result.url; })
        );
      } else if (!documentBack.length) {
        updatedData.documentBackURL = '';
      }

      // Guardian Document
      if (guardianDocument.length && guardianDocument[0].originFileObj) {
        uploadPromises.push(
          uploadFile(`/users/${user.uid}/programs/${programId}/members`, guardianDocument[0].originFileObj)
            .then(result => { updatedData.guardianDocumentURL = result.url; })
        );
      }

      // Guardian Document Back
      if (guardianDocumentBack.length && guardianDocumentBack[0].originFileObj) {
        uploadPromises.push(
          uploadFile(`/users/${user.uid}/programs/${programId}/members`, guardianDocumentBack[0].originFileObj)
            .then(result => { updatedData.guardianDocumentBackURL = result.url; })
        );
      }

      // Wait for all uploads
      await Promise.all(uploadPromises);

      const agentName = values.addedBy === 'agent' 
        ? agentsList.find(agent => agent.id === values.selectedAgent)?.displayName || '' 
        : '';

      // Calculate payment amounts
      let joinFeesPaidAmount = 0;
      let joinFeesRemainingAmount = 0;
      
      if (values.joinFeesDone) {
        if (values.joinFeesPaymentType === 'full') {
          joinFeesPaidAmount = joinFees;
          joinFeesRemainingAmount = 0;
        } else if (values.joinFeesPaymentType === 'custom') {
          joinFeesPaidAmount = values.customJoinFeesAmount || 0;
          joinFeesRemainingAmount = joinFees - joinFeesPaidAmount;
        }
      }

      // Update member data
      const updatedMemberData = {
        ...updatedData,
        displayName: values.displayName,
        dateJoin: values.dateJoin.format('DD-MM-YYYY'),
        fatherName: values.fatherName,
        guardian: values.guardian,
        guardianRelation: values.guardianRelation,
        gender: values.gender,
        gotra: values.gotra || '',
        jati: values.jati || '',
        phone: values.phone,
        phoneAlt: values.phoneAlt || '',
        aadhaarNo: values.aadhaarNo,
        guardianAadharNo: values.guardianAadharNo || '',
        applicationNumber: String(values.applicationNumber ?? '').trim(),
        bobDate: values.bobDate.format('DD-MM-YYYY'),
        currentAddress: values.currentAddress,
        village: values.village,
        state: values.state,
        district: values.district,
        pinCode: values.pinCode,
        closingMonths: values.closingMonths || 0,
        ageGroup: selectedAgeGroup?.id,
        ageGroupRange: selectedAgeGroup ? `${selectedAgeGroup?.startAge}-${selectedAgeGroup?.endAge}` : '',
        memberGroup: selectedLocationGroup?.groupName || 'Group_A',
        locationGroup: selectedLocationGroup?.location || '',
        locactionGroupId: selectedLocationGroup?.id || '',
        payAmount: effectivePay,
        ...(values.fixedLimit !== undefined ? { fixedLimit: values.fixedLimit || null } : {}), // fixed rakam (only when the field is shown)
        joinFees: joinFees,
        joinFeesDone: values.joinFeesDone || false,
        joinFeesTxtId: values.joinFeesTxtId || "",
        joinFeesPaymentType: values.joinFeesPaymentType || "",
        joinFeesPaidAmount: joinFeesPaidAmount,
        joinFeesRemainingAmount: joinFeesRemainingAmount,
        addedBy: values.addedBy,
        addedByName: values.addedBy === 'agent' ? agentName : 'Admin',
        agentId: values.addedBy === 'agent' ? values.selectedAgent : null,
        extraDetails: extraFields.filter(f => f.label && f.value),
        note: values.note || memberData.note || '',
        updatedAt: new Date(),
      };

      // Update in Firestore
      const res = await api.patch(`/members/${memberData.id}`, updatedMemberData);

      message.success('सदस्य सफलतापूर्वक अपडेट किया गया!');
      // join date changed → closing dues were re-synced on the server
      if (res?.duesAdded || res?.duesRemoved) {
        message.info(`जुड़ने की तिथि के अनुसार क्लोजिंग भुगतान अपडेट: ${res.duesAdded || 0} जोड़े, ${res.duesRemoved || 0} हटाए`, 6);
      }
      setOpen(false);
      
      if (onSuccess) {
        onSuccess(updatedMemberData);
      }

    } catch (error) {
      console.error('सदस्य अपडेट करने में त्रुटि:', error);
      // server explains why (e.g. payment already received for a closing the new join date excludes)
      message.error(error?.status === 409 || error?.status === 403 ? error.message : 'सदस्य अपडेट करने में विफल। कृपया पुनः प्रयास करें।', 8);
    } finally {
      setLoading(false);
    }
  };

  if (!memberData) return null;

  return (
    <>
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>सदस्य विवरण संपादित करें</Title>}
        width={800}
        placement="right"
        onClose={() => !loading && setOpen(false)}
        open={open}
        maskClosable={false}
        keyboard={false}
        closable={!loading}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setOpen(false)} size="large" disabled={loading}>
              रद्द करें
            </Button>
            <Button
              onClick={() => form.submit()}
              type="primary"
              loading={loading}
              disabled={loading}
              size="large"
              icon={loading ? <LoadingOutlined /> : null}
            >
              {loading ? 'अपडेट हो रहा है...' : 'अपडेट करें'}
            </Button>
          </Space>
        }
      >
        {loading ? (
          <div className='min-h-[50vh] w-full flex flex-col items-center justify-center'>
            <Spin spinning={loading} size="large" />
            <div style={{ marginTop: 16 }}>
              <Text strong style={{ fontSize: '16px', display: 'block', marginBottom: 8 }}>
                सदस्य अपडेट हो रहा है...
              </Text>
              <Text type="secondary">कृपया प्रतीक्षा करें</Text>
            </div>
          </div>
        ) : (
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            scrollToFirstError
            disabled={loading}
          >
            {/* कार्यक्रम जानकारी (Read-only) */}
            <Card className="mb-4" size="small">
              <Form.Item label={<Text strong>कार्यक्रम</Text>}>
                <Input value={selectedProgram?.name} disabled />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} sm={12} lg={8}>
                  <Form.Item label="पंजीकरण संख्या">
                    <Input value={memberData.registrationNumber} disabled />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                  <Form.Item label="सदस्य संख्या">
                    <Input value={memberData.memberNumber} disabled />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                  <Form.Item
                    name="dateJoin"
                    label="जुड़ने की तारीख"
                    rules={[{ required: true, message: 'आवश्यक' }]}
                  >
                    <DatePicker
                      style={{ width: '100%' }}
                      format="DD-MM-YYYY"
                      prefix={<CalendarOutlined />}
                      disabledDate={(current) => current && current > dayjs()}
                      onChange={handleJoinDateChange}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            {/* व्यक्तिगत जानकारी */}
            <Divider orientation="left">व्यक्तिगत जानकारी</Divider>
            <DuplicateWarning form={form} excludeId={memberData?.id} />

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                  <Form.Item
                    name="applicationNumber"
                    label="एप्लीकेशन नंबर"
                    rules={[
                      { required: true, message: 'एप्लीकेशन नंबर आवश्यक है' },
                      {
                        // अक्षर भी चलेंगे — जैसे 67A, 12/B, 45-C
                        pattern: /^[A-Za-z0-9/-]+$/,
                        message: 'केवल अंक, अक्षर और - / की अनुमति है',
                      },
                    ]}
                    tooltip="अक्षर चलेंगे (जैसे 67A) और duplicate नंबर की भी अनुमति है"
                  >
                    <Input
                      prefix={<IdcardOutlined />}
                      placeholder="एप्लीकेशन नंबर"
                      onBlur={async (e) => {
                        const v = String(e.target.value ?? '').trim();
                        if (!v) return;
                        // सिर्फ़ सूचना — save फिर भी हो जाएगा
                        if (await checkApplicationNumberDuplicate(v)) {
                          message.warning(
                            `ध्यान दें: एप्लीकेशन नंबर ${v} किसी और सदस्य के पास भी है (duplicate की अनुमति है)`
                          );
                        }
                      }}
                    />
                  </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="displayName"
                  label="नाम"
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="पूरा नाम" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="fatherName"
                  label="पिता का नाम"
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="पिता का नाम" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item name="gotra" label="गोत्र (Gotra) (वैकल्पिक)">
                  <AutoComplete
                        placeholder="गोत्र चुनें या लिखें"
                        options={gotras.map(g => ({ value: g.value }))}
                        filterOption={(input, option) => option.value.toUpperCase().includes(input.toUpperCase())}
                      />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="jati" label="जाति (Caste) (वैकल्पिक)">
                  <AutoComplete
                    placeholder="जाति चुनें या लिखें"
                    options={castes.map(c => ({ value: c.value }))}
                    filterOption={(input, option) => option.value.toUpperCase().includes(input.toUpperCase())}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="guardian"
                  label={`${guardianLabel} का नाम`}
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder={`${guardianLabel} का नाम`} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="guardianRelation"
                  label={`${guardianLabel} से संबंध`}
                  rules={[{ required: true, message: 'कृपया संबंध चुनें' }]}
                >
                  <AutoComplete
                    placeholder={`${guardianLabel} से संबंध चुनें या लिखें`}
                    options={guardianRelations.map(r => ({ value: r.value }))}
                    filterOption={(inputValue, option) =>
                      option.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="gender"
                  label="Gender(लिंग)"
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <Select placeholder="लिंग चुनें" showSearch>
                    {gender.map(state => (
                      <Option key={state.value} value={state.value}>{state.label}</Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="guardianAadharNo"
                  label={`${guardianLabel} का आधार (वैकल्पिक)`}
                  rules={[
                    { len: 12, message: '12 अंक होने चाहिए' },
                    { pattern: /^[0-9]{12}$/, message: 'अमान्य आधार' }
                  ]}
                >
                  <Input
                    prefix={<IdcardOutlined />}
                    placeholder="12 अंकों का आधार (वैकल्पिक)"
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* संपर्क जानकारी */}
            <Divider orientation="left">संपर्क जानकारी</Divider>

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="phone"
                  label="प्राथमिक फ़ोन"
                  rules={[
                    { required: true, message: 'आवश्यक' },
                    { len: 10, message: '10 अंक होने चाहिए' },
                    { pattern: /^[0-9]{10}$/, message: 'अमान्य फ़ोन नंबर' }
                  ]}
                >
                  <Input prefix={<PhoneOutlined />} placeholder="10 अंकों का नंबर" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="phoneAlt"
                  label="वैकल्पिक फ़ोन"
                  rules={[
                    { len: 10, message: '10 अंक होने चाहिए' },
                    { pattern: /^[0-9]{10}$/, message: 'अमान्य फ़ोन नंबर' }
                  ]}
                >
                  <Input prefix={<PhoneOutlined />} placeholder="वैकल्पिक" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="aadhaarNo"
                  label="आधार संख्या"
                  rules={[
                    { required: true, message: 'आवश्यक' },
                    { len: 12, message: '12 अंक होने चाहिए' },
                    { pattern: /^[0-9]{12}$/, message: 'अमान्य आधार' }
                  ]}
                >
                  <Input prefix={<IdcardOutlined />} placeholder="12 अंकों का आधार" />
                </Form.Item>
              </Col>
            </Row>

            {/* आयु और कार्यक्रम विवरण */}
            <Divider orientation="left">आयु और कार्यक्रम विवरण</Divider>

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="bobDate"
                  label="जन्म तिथि"
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <DatePicker
                    style={{ width: '100%' }}
                    format="DD-MM-YYYY"
                    onChange={handleDateOfBirthChange}
                    disabledDate={(current) => current && current > dayjs()}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item label="आयु समूह">
                  <Input
                    value={selectedAgeGroup ? `${selectedAgeGroup.startAge}-${selectedAgeGroup.endAge} वर्ष` : ''}
                    disabled
                    placeholder="स्वचालित रूप से गणना"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="locationGroup"
                  label="स्थान समूह"
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <Select
                    placeholder="स्थान चुनें"
                    onChange={(value) => {
                      const group = selectedProgram?.locationGroups?.find(g => g.id === value);
                      setSelectedLocationGroup(group);
                    }}
                    value={selectedLocationGroup?.id}
                  >
                    {selectedProgram?.locationGroups?.map(group => (
                      <Option key={group.id} value={group.id}>
                        {group.location} - {group.groupName}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item label="वेतन राशि" extra={effectivePay === 0 ? <span className="text-amber-600">₹0 — इस सदस्य से कोई क्लोजिंग भुगतान नहीं लिया जाएगा</span> : null}>
                  <Input
                    value={`₹${effectivePay}`}
                    disabled
                    style={{ fontWeight: 'bold', color: '#52c41a' }}
                  />
                </Form.Item>
              </Col>
              <FixedLimitField payAmount={effectivePay} />
              <Col xs={24} sm={12} lg={8}>
                <Form.Item label="नामांकन शुल्क">
                  <Input
                    value={`₹${joinFees}`}
                    disabled
                    style={{ fontWeight: 'bold', color: '#1890ff' }}
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* Join Fees Section */}
            <Divider orientation="left">नामांकन शुल्क</Divider>
            <Card size="small">
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item name="joinFeesDone" valuePropName="checked">
                    <Checkbox onChange={(e) => {
                      setIsJoinFeesDone(e.target.checked);
                      if (!e.target.checked) {
                        // Reset payment type and custom amount when unchecked
                        form.setFieldsValue({
                          joinFeesPaymentType: undefined,
                          customJoinFeesAmount: undefined,
                          joinFeesTxtId: undefined
                        });
                        setJoinFeesPaymentType(null);
                        setCustomJoinFeesAmount(0);
                      }
                    }}>
                      Join Fees जमा हुआ?
                    </Checkbox>
                  </Form.Item>
                </Col>
              </Row>

              {isJoinFeesDone && (
                <>
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="joinFeesPaymentType"
                        label="भुगतान प्रकार"
                        rules={[{ required: true, message: 'कृपया भुगतान प्रकार चुनें' }]}
                      >
                        <Select 
                          placeholder="भुगतान प्रकार चुनें"
                          onChange={(value) => {
                            setJoinFeesPaymentType(value);
                            if (value === 'full') {
                              setCustomJoinFeesAmount(joinFees);
                              form.setFieldsValue({
                                customJoinFeesAmount: joinFees
                              });
                            } else if (value === 'custom') {
                              setCustomJoinFeesAmount(0);
                              form.setFieldsValue({
                                customJoinFeesAmount: undefined
                              });
                            }
                          }}
                        >
                          <Option value="full">Full Paid (₹{joinFees})</Option>
                          <Option value="custom">Custom Paid</Option>
                        </Select>
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={12}>
                      {joinFeesPaymentType === 'custom' && (
                        <Form.Item
                          name="customJoinFeesAmount"
                          label="भुगतान राशि"
                          rules={[
                            { required: true, message: 'कृपया भुगतान राशि दर्ज करें' },
                            {
                              validator: (_, value) => {
                                if (value && (value <= 0 || value > joinFees)) {
                                  return Promise.reject(new Error(`राशि ₹1 और ₹${joinFees} के बीच होनी चाहिए`));
                                }
                                return Promise.resolve();
                              }
                            }
                          ]}
                        >
                          <Input
                            size='large'
                            type='number'
                            prefix="₹"
                            placeholder={`₹1 - ₹${joinFees} दर्ज करें`}
                            onChange={(e) => {
                              const amount = parseFloat(e.target.value);
                              if (!isNaN(amount)) {
                                setCustomJoinFeesAmount(amount);
                              }
                            }}
                          />
                        </Form.Item>
                      )}
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={24}>
                      <Form.Item
                        name="joinFeesTxtId"
                        label="Join Fees Transaction ID"
                        rules={[
                          { required: true, message: 'कृपया Transaction ID दर्ज करें' },
                        ]}
                      >
                        <Input
                          size='large'
                          placeholder='Enter Join Fees Transaction ID'
                          autoComplete='off'
                          prefix={<IdcardOutlined />}
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* Display payment summary */}
                  {(joinFeesPaymentType === 'full' || 
                    (joinFeesPaymentType === 'custom' && customJoinFeesAmount > 0)) && (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded">
                      <Text strong>भुगतान सारांश:</Text>
                      <div className="mt-1">
                        <Text>कुल नामांकन शुल्क: ₹{joinFees}</Text>
                        <br />
                        <Text type="success">
                          भुगतान राशि: ₹
                          {joinFeesPaymentType === 'full' 
                            ? joinFees 
                            : customJoinFeesAmount || 0}
                        </Text>
                        {joinFeesPaymentType === 'custom' && 
                         customJoinFeesAmount > 0 && 
                         customJoinFeesAmount < joinFees && (
                          <>
                            <br />
                            <Text type="danger">
                              बकाया राशि: ₹{joinFees - customJoinFeesAmount}
                            </Text>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* पता जानकारी */}
            <Divider orientation="left">पता जानकारी</Divider>

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="state"
                  label="राज्य"
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <Select placeholder="राज्य चुनें" showSearch onChange={handleStateSelect}>
                    {states.map(state => (
                      <Option key={state.value} value={state?.value}>{state?.label}</Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="district"
                  label="ज़िला (District)"
                  rules={[{ required: true, message: 'आवश्यक' }]}
                >
                  <Select placeholder="ज़िला चुनें" showSearch disabled={districts.length === 0}>
                    {districts.map(district => (
                      <Option key={district.value} value={district?.value}>{district?.label}</Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="village"
                  label="गाँव"
                  rules={[
                    { required: true, message: 'आवश्यक' },
                    { pattern: /^[a-zA-Z\s\u0900-\u097F]{2,50}$/, message: 'केवल अक्षर (2-50 अक्षर)' }
                  ]}
                >
                  <Input prefix={<HomeOutlined />} placeholder="गाँव का नाम" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  name="pinCode"
                  label="पिन कोड"
                  rules={[
                    { required: true, message: 'आवश्यक' },
                    { len: 6, message: '6 अंक होने चाहिए' }
                  ]}
                >
                  <Input placeholder="6 अंकों का पिनकोड" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="currentAddress"
              label="वर्तमान पता"
              rules={[{ required: true, message: 'आवश्यक' }]}
            >
              <TextArea rows={2} placeholder="पूरा पता" />
            </Form.Item>

            <Form.Item name="note" label="नोट">
              <TextArea rows={2} placeholder="कोई विशेष नोट हो तो लिखें" />
            </Form.Item>

            {/* दस्तावेज़ और फोटो अपलोड */}
            <Divider orientation="left">दस्तावेज़ और फोटो</Divider>

            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item label="सदस्य का फोटो">
                  <ImgCrop 
                    rotate 
                    showGrid 
                    rotationSlider 
                    aspectSlider 
                    showReset
                    quality={0.9}
                  >
                    <Upload
                      listType="picture-card"
                      fileList={photo}
                      onChange={handleUploadChange(setPhoto)}
                      onPreview={onPreview}
                      onRemove={handleRemovePhoto}
                      maxCount={1}
                      accept="image/*"
                    >
                      {!photo.length && (
                        <div>
                          <CameraOutlined />
                          <div style={{ marginTop: 8 }}>फोटो</div>
                        </div>
                      )}
                    </Upload>
                  </ImgCrop>
                </Form.Item>
              </Col>

              <Col xs={24} sm={12} lg={8}>
                <Form.Item label="अतिरिक्त फोटो">
                  <ImgCrop 
                    rotate 
                    showGrid 
                    rotationSlider 
                    aspectSlider 
                    showReset
                    quality={0.9}
                  >
                    <Upload
                      listType="picture-card"
                      fileList={extraPhoto}
                      onChange={handleUploadChange(setExtraPhoto)}
                      onPreview={onPreview}
                      onRemove={handleRemovePhoto}
                      maxCount={1}
                      accept="image/*"
                    >
                      {!extraPhoto.length && (
                        <div>
                          <UploadOutlined />
                          <div style={{ marginTop: 8 }}>अतिरिक्त</div>
                        </div>
                      )}
                    </Upload>
                  </ImgCrop>
                </Form.Item>
              </Col>

              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  label="दस्तावेज़ अग्र भाग (Front) *"
                  required
                  tooltip="आईडी दस्तावेज़ का अग्र भाग अपलोड करें"
                >
                  <Upload
                    listType="picture-card"
                    fileList={documentFront}
                    onChange={handleUploadChange(setDocumentFront)}
                    onPreview={onPreview}
                    onRemove={handleRemovePhoto}
                    beforeUpload={() => false}
                    maxCount={1}
                  >
                    {!documentFront.length && (
                      <div>
                        <UploadOutlined />
                        <div style={{ marginTop: 8 }}>फ्रंट</div>
                      </div>
                    )}
                  </Upload>
                </Form.Item>
              </Col>
            </Row>
            
            <Row gutter={16}>
              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  label="दस्तावेज़ पिछला भाग (Back) (Optional)"
                  tooltip="आईडी दस्तावेज़ का पिछला भाग अपलोड करें (वैकल्पिक)"
                >
                  <Upload
                    listType="picture-card"
                    fileList={documentBack}
                    onChange={handleUploadChange(setDocumentBack)}
                    onPreview={onPreview}
                    onRemove={handleRemovePhoto}
                    beforeUpload={() => false}
                    maxCount={1}
                  >
                    {!documentBack.length && (
                      <div>
                        <UploadOutlined />
                        <div style={{ marginTop: 8 }}>बैक</div>
                      </div>
                    )}
                  </Upload>
                </Form.Item>
              </Col>

              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  label={`${guardianLabel} का दस्तावेज़ *`}
                  required
                  tooltip={`${guardianLabel} की आईडी अपलोड करें`}
                >
                  <Upload
                    listType="picture-card"
                    fileList={guardianDocument}
                    onChange={handleUploadChange(setGuardianDocument)}
                    onPreview={onPreview}
                    onRemove={handleRemovePhoto}
                    beforeUpload={() => false}
                    maxCount={1}
                  >
                    {!guardianDocument.length && (
                      <div>
                        <UploadOutlined />
                        <div style={{ marginTop: 8 }}>{guardianLabel}</div>
                      </div>
                    )}
                  </Upload>
                </Form.Item>
              </Col>

              <Col xs={24} sm={12} lg={8}>
                <Form.Item
                  label={`${guardianLabel} का दस्तावेज़ पिछला भाग (Optional)`}
                  tooltip={`${guardianLabel} की आईडी का पिछला भाग (वैकल्पिक)`}
                >
                  <Upload
                    listType="picture-card"
                    fileList={guardianDocumentBack}
                    onChange={handleUploadChange(setGuardianDocumentBack)}
                    onPreview={onPreview}
                    onRemove={handleRemovePhoto}
                    beforeUpload={() => false}
                    maxCount={1}
                  >
                    {!guardianDocumentBack.length && (
                      <div>
                        <UploadOutlined />
                        <div style={{ marginTop: 8 }}>{guardianLabel} बैक</div>
                      </div>
                    )}
                  </Upload>
                </Form.Item>
              </Col>
            </Row>

            {/* अतिरिक्त जानकारी (Dynamic Fields) */}
            <Divider orientation="left">अतिरिक्त जानकारी (Optional)</Divider>
            <Card size="small">
              {extraFields.map((field, index) => (
                <Row gutter={16} key={index} className="mb-2">
                  <Col xs={24} sm={12} lg={8}>
                    <Input
                      prefix={<TagOutlined />}
                      placeholder="लेबल (उदाहरण: व्यवसाय)"
                      value={field.label}
                      onChange={(e) => handleExtraFieldChange(index, 'label', e.target.value)}
                    />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Input
                      placeholder="मान (Value)"
                      value={field.value}
                      onChange={(e) => handleExtraFieldChange(index, 'value', e.target.value)}
                    />
                  </Col>
                  <Col xs={12} sm={8} xl={4}>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveExtraField(index)}
                    >
                      हटाएँ
                    </Button>
                  </Col>
                </Row>
              ))}
              <Button
                type="dashed"
                onClick={handleAddExtraField}
                block
                icon={<PlusOutlined />}
                style={{ marginTop: extraFields.length > 0 ? 16 : 0 }}
              >
                और फ़ील्ड जोड़ें
              </Button>
            </Card>

            {/* व्यवस्थापक/एजेंट चयन */}
            <Divider orientation="left">जोड़ा गया</Divider>

            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="addedBy"
                  label="जोड़ा गया"
                  rules={[{ required: true }]}
                >
                  <Select onChange={setAddedBy}>
                    <Option value="admin">व्यवस्थापक (Admin)</Option>
                    <Option value="agent">एजेंट</Option>
                  </Select>
                </Form.Item>
              </Col>

              {addedBy === 'agent' && (
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="selectedAgent"
                    label="एजेंट चुनें"
                    rules={[{ required: true, message: 'कृपया एक एजेंट चुनें' }]}
                  >
                    <Select
                      placeholder="एजेंट चुनें"
                      showSearch
                      optionFilterProp="children"
                    >
                      {agentsList.map(agent => (
                        <Option key={agent.id} value={agent.id}>
                          {agent.displayName}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
              )}
            </Row>

            <Divider orientation="left">सदस्यता समाप्ति</Divider>
            <Card size="small">
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item
                    name="closingMonths"
                    label="सदस्यता समाप्ति महीने (Membership Closing Months)"
                    tooltip="कितने महीनों बाद यह सदस्य बंद/निष्क्रिय हो जाएगा?"
                    rules={[
                      { 
                        validator: (_, value) => {
                          if (value && (value < 0 || value > 120)) {
                            return Promise.reject(new Error('कृपया 0 से 120 महीनों के बीच मान दर्ज करें'));
                          }
                          return Promise.resolve();
                        }
                      }
                    ]}
                  >
                    <Input
                      type="number"
                      size="large"
                      placeholder="महीनों की संख्या दर्ज करें (उदा: 6, 12, 24)"
                      prefix={<CalendarOutlined />}
                      suffix="महीने"
                      onChange={(e) => {
                        const months = parseInt(e.target.value);
                        setClosingDays(months);
                      }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            {/* Hidden field for age group ID */}
            <Form.Item name="ageGroup" hidden>
              <Input />
            </Form.Item>
          </Form>
        )}
      </Drawer>
    </>
  );
}

export default EditMember;