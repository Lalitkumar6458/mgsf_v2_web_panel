import React, { useState, useEffect } from 'react';
import { Button, Drawer, Form, Input, InputNumber, Select, Space, Card, Typography, App, Radio, Alert, Tag, message } from 'antd';
import { FiPlusCircle, FiTrash2, FiUser, FiMapPin, FiDollarSign, FiCalendar, FiTag, FiEdit2, FiSave, FiHash } from 'react-icons/fi';
import { REG_DEFAULTS, previewRegistrationNumbers } from '@/lib/helper';
import { COUNT_MODES, displayCount, normalizeCountDisplay } from '@/lib/memberCountDisplay';
import { useAuth, useFeature } from '@/lib/AuthProvider';
import { api } from "@/lib/client/api";
import { setgetMemberDataChange, setPrograms } from '@/redux/slices/commonSlice';
import { useDispatch, useSelector } from 'react-redux';

const { TextArea } = Input;
const { Title, Text } = Typography;

const AddProgramEdit = ({ program, mode = 'add', onSuccess, triggerButton = null,isDrawerOpen,setIsDrawerOpen }) => {
  const { message: antdMessage } = App.useApp();
  const [form] = Form.useForm();
  const { user } = useAuth();
  const countOn = useFeature()('countDisplay');
  const [loading, setLoading] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const dispatch=useDispatch()
  const programList = useSelector((state) => state.data.programList);

  const locationGroupTypes = [
    { label: 'Group A', value: 'A' },
    { label: 'Group B', value: 'B' },
    { label: 'Group C', value: 'C' },
  ];

  const programCategories = [
    { label: 'Suraksha', value: 'isSuraksha' },
    { label: 'Mamera', value: 'isMamera' },
    { label: 'Vivah', value: 'isVivah' },
    { label: 'Other', value: 'isOther' },
  ];

  // Live preview of the registration number format. Watching the fields keeps
  // the sample in sync as the user types, so the format is obvious before save.
  const regPrefix  = Form.useWatch('regPrefix', form);
  const regMode    = Form.useWatch('regMode', form);
  const regDigits  = Form.useWatch('regDigits', form);
  const regStartNo = Form.useWatch('regStartNo', form);
  const countMode    = Form.useWatch('countMode', form) || 'actual';
  const countPercent = Form.useWatch('countPercent', form);
  const countFixed   = Form.useWatch('countFixed', form);
  // members on books right now (edit) — for the live "dikhega" preview
  const realCount = mode === 'edit' ? (program?.totalMembers ?? 0) : 0;
  const shownCount = displayCount(realCount, normalizeCountDisplay(
    { mode: countMode, percent: countPercent, fixed: countFixed },
    mode === 'edit' ? program?.extra?.countDisplay : {}, realCount));

  // Numbers already issued in this program — a series must not restart below it
  const issuedCounter = parseInt(program?.regCounter, 10) || 0;

  const regSamples = previewRegistrationNumbers(
    {
      regPrefix: regPrefix ?? REG_DEFAULTS.regPrefix,
      regMode: regMode ?? REG_DEFAULTS.regMode,
      regDigits: regDigits ?? REG_DEFAULTS.regDigits,
      regStartNo: regStartNo ?? REG_DEFAULTS.regStartNo,
      regCounter: mode === 'edit' ? issuedCounter : 0,
    },
    3
  );

  // Initialize form with program data when in edit mode
  useEffect(() => {
    if (mode === 'edit' && program && isDrawerOpen) {
      // Set isSelected from program data (default to false if not exists)
      setIsSelected(program.isSelected || false);
      
      // Determine selected category
      let selectedCategory = 'isOther';
      programCategories.forEach(cat => {
        if (program[cat.value]) {
          selectedCategory = cat.value;
        }
      });

      form.setFieldsValue({
        name: program.name,
        hiname: program.hiname,
        guname: program.guname || "",
        noteLine: program.noteLine || '',
        about: program.about,
        countMode: program.extra?.countDisplay?.mode || 'actual',
        countPercent: program.extra?.countDisplay?.percent ?? 70,
        countFixed: program.extra?.countDisplay?.fixed ?? program?.totalMembers ?? 0,
        category: selectedCategory,
        dueDays: program.dueDays ?? 45,
        defaultPayAmount: program.defaultPayAmount ?? 200,
        ageGroups: program.ageGroups || [],
        locationGroups: program.locationGroups || [],
        // Registration number settings (fall back to defaults for older programs)
        regPrefix: program.regPrefix ?? REG_DEFAULTS.regPrefix,
        regMode: program.regMode === 'series' ? 'series' : REG_DEFAULTS.regMode,
        regDigits: program.regDigits ?? REG_DEFAULTS.regDigits,
        regStartNo: program.regStartNo ?? REG_DEFAULTS.regStartNo,
      });
    } else if (mode === 'add' && isDrawerOpen) {
      // Reset form for add mode
      setIsSelected(false);
      form.resetFields();
      form.setFieldsValue({ ...REG_DEFAULTS, countMode: 'actual', countPercent: 70, countFixed: 0, dueDays: 45, defaultPayAmount: 200 });
    }
  }, [mode, program, isDrawerOpen, form]);

  const handleSubmit = async (values) => {
    if (!user?.uid) {
      antdMessage.error("User not authenticated!");
      return;
    }
    
    setLoading(true);
    try {
      // Add unique id to each age group and location group if not exists
      const ageGroupsWithId = (values.ageGroups || []).map(group => ({
        ...group,
        id: group.id || (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)
      }));
      
      const locationGroupsWithId = (values.locationGroups || []).map(group => ({
        ...group,
        id: group.id || (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)
      }));

      // Create category flags based on selected category
      const categoryFlags = {
        isSuraksha: false,
        isMamera: false,
        isVivah: false,
        isOther: false,
      };
      
      // Set the selected category to true
      if (values.category) {
        categoryFlags[values.category] = true;
      }

      // how the member count is shown (server keeps the starting point of a fixed count)
      const countDisplay = {
        mode: values.countMode || 'actual',
        percent: values.countPercent,
        fixed: values.countFixed,
      };

      // Registration number settings for this yojna
      const regSettings = {
        regPrefix: (values.regPrefix ?? REG_DEFAULTS.regPrefix).trim(),
        regMode: values.regMode === 'series' ? 'series' : 'random',
        regDigits: parseInt(values.regDigits, 10) || REG_DEFAULTS.regDigits,
        regStartNo: parseInt(values.regStartNo, 10) || REG_DEFAULTS.regStartNo,
      };

      if (mode === 'add') {
        await api.post('/programs', {
          name: values.name,
          hiname: values.hiname,
          guname: values.guname || "",
          noteLine: values.noteLine || '',
          about: values.about,
          category: values.category || '',
          extra: { ...categoryFlags, countDisplay },
          ...regSettings,
          dueDays: values.dueDays ?? 45,
          defaultPayAmount: values.defaultPayAmount ?? 200,
          isSelected: isSelected,
          ageGroups: ageGroupsWithId,
          locationGroups: locationGroupsWithId,
        });
        
        antdMessage.success('Program created successfully!');
      } else if (mode === 'edit' && program?.id) {
        // regCounter is never sent from this form — the server owns it.
        // Member counts are calculated live, so they are not saved either.
        await api.patch(`/programs/${program.id}`, {
          name: values.name,
          hiname: values.hiname,
          guname: values.guname || "",
          noteLine: values.noteLine || '',
          about: values.about,
          category: values.category || '',
          extra: { ...(program.extra || {}), ...categoryFlags, countDisplay },
          ...regSettings,
          dueDays: values.dueDays ?? 45,
          defaultPayAmount: values.defaultPayAmount ?? 200,
          isSelected: isSelected,
          ageGroups: ageGroupsWithId,
          locationGroups: locationGroupsWithId,
        });
        
        antdMessage.success('Program updated successfully!');
          const programs=programList.map((item)=>{
        if(item.id ===program.id){
          return {
            ...item,
                 name: values.name,
          hiname: values.hiname,
          guname:values.guname,
          noteLine: values.noteLine || '',
          about: values.about,
          ...categoryFlags,
          ...regSettings,
          dueDays: values.dueDays ?? 45,
          defaultPayAmount: values.defaultPayAmount ?? 200,
          isSelected: isSelected,
            extra: { ...(item.extra || {}), countDisplay },
          ageGroups: ageGroupsWithId,
          locationGroups: locationGroupsWithId,
          updatedAt: new Date(),
          }
        }else{
          return item
        }
      })
      dispatch(setPrograms(programs))
      }
      
    
 
      
      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }
      dispatch(setgetMemberDataChange(true));
      form.resetFields();
      setIsDrawerOpen(false);
    } catch (error) {
      console.error(`Error ${mode === 'add' ? 'adding' : 'updating'} program:`, error);
      antdMessage.error(`Failed to ${mode === 'add' ? 'create' : 'update'} program.`);
    }
    setLoading(false);
  };

  const AgeGroupCard = ({ field, remove }) => (
    <Card 
      key={field.key}
      className="bg-white hover:shadow-md transition-all duration-200 border border-gray-200"
      extra={
        <Button
          type="text"
          icon={<FiTrash2 className="text-red-500 hover:text-red-600" />}
          onClick={() => remove(field.name)}
          className="hover:bg-red-50"
        />
      }
      title={
        <div className="flex items-center gap-2">
          <FiCalendar className="text-blue-500" />
          <Text strong>Age Group {field.name + 1}</Text>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-6">
        <Form.Item
          {...field}
          label="Start Age"
          name={[field.name, 'startAge']}
          rules={[{ required: true, message: 'Required' }]}
        >
          <InputNumber 
            placeholder="Start age" 
            className="w-full h-10" 
            min={0}
            max={100}
          />
        </Form.Item>
        <Form.Item
          {...field}
          label="End Age"
          name={[field.name, 'endAge']}
          rules={[{ required: true, message: 'Required' }]}
        >
          <InputNumber 
            placeholder="End age" 
            className="w-full h-10" 
            min={0}
            max={100}
          />
        </Form.Item>
        <Form.Item
          {...field}
          label={
            <div className="flex items-center gap-1">
              <FiDollarSign className="text-green-500" />
              <span>Joining Fee</span>
            </div>
          }
          name={[field.name, 'joinFee']}
          rules={[{ required: true, message: 'Required' }]}
        >
          <InputNumber 
            placeholder="Amount" 
            className="w-full h-10"
            prefix="₹"
            min={0}
          />
        </Form.Item>
        <Form.Item
          {...field}
          label={
            <div className="flex items-center gap-1">
              <FiDollarSign className="text-green-500" />
              <span>Pay Amount</span>
            </div>
          }
          name={[field.name, 'payAmount']}
          rules={[{ required: true, message: 'Required' }]}
        >
          <InputNumber 
            placeholder="Amount" 
            className="w-full h-10"
            prefix="₹"
            min={0}
          />
        </Form.Item>
      </div>
      {/* Hidden field for ID */}
      <Form.Item
        {...field}
        name={[field.name, 'id']}
        hidden
      >
        <Input type="hidden" />
      </Form.Item>
    </Card>
  );

  const LocationGroupCard = ({ field, remove }) => (
    <Card 
      key={field.key}
      className="bg-white hover:shadow-md transition-all duration-200 border border-gray-200"
      extra={
        <Button
          type="text"
          icon={<FiTrash2 className="text-red-500 hover:text-red-600" />}
          onClick={() => remove(field.name)}
          className="hover:bg-red-50"
        />
      }
      title={
        <div className="flex items-center gap-2">
          <FiMapPin className="text-purple-500" />
          <Text strong>Location Group {field.name + 1}</Text>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-6">
        <Form.Item
          {...field}
          label="Group Name"
          name={[field.name, 'groupName']}
          rules={[{ required: true, message: 'Required' }]}
        >
          <Input 
            placeholder="Enter group name" 
            className="h-10 w-full"
            prefix={<FiUser className="text-gray-400" />}
          />
        </Form.Item>
        <Form.Item
          {...field}
          label="Location"
          name={[field.name, 'location']}
          rules={[{ required: true, message: 'Required' }]}
        >
          <Input 
            placeholder="Enter location" 
            className="h-10 w-full"
            prefix={<FiMapPin className="text-gray-400" />}
          />
        </Form.Item>
        <Form.Item
          {...field}
          label="Location Group"
          name={[field.name, 'groupType']}
          rules={[{ required: true, message: 'Required' }]}
          className="col-span-2"
        >
          <Select
            placeholder="Select group type"
            options={locationGroupTypes}
            className="h-10 w-full"
          />
        </Form.Item>
      </div>
      {/* Hidden field for ID */}
      <Form.Item
        {...field}
        name={[field.name, 'id']}
        hidden
      >
        <Input type="hidden" />
      </Form.Item>
    </Card>
  );

  const handleOpenDrawer = () => {
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    form.resetFields();
  };

  return (
    <>
      {/* Custom trigger button or default button */}
   

      <Drawer
        title={
          <div className="flex items-center gap-2">
            {mode === 'edit' ? <FiEdit2 className="text-blue-500" /> : <FiPlusCircle className="text-blue-500" />}
            <Title level={4} className="!mb-0">
              {mode === 'edit' ? 'Edit Program' : 'Create New Program'}
            </Title>
          </div>
        }
        placement="right"
        onClose={handleCloseDrawer}
        open={isDrawerOpen}
        width={600}
        className="custom-drawer"
       destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          className="h-full"
        >
          <div className="space-y-6 pb-20">
            {/* Basic Information */}
            <Card className="border border-gray-200">
              <Title level={5} className="!mb-4 flex items-center gap-2">
                <FiUser className="text-blue-500" />
                Basic Information
              </Title>
              <Space direction="vertical" className="w-full">
                <Form.Item
                  label="Program Name"
                  name="name"
                  rules={[{ required: true, message: 'Please enter program name' }]}
                >
                  <Input 
                    placeholder="Enter program name" 
                    className="h-10"
                  />
                </Form.Item>
                <Form.Item
                  label="Hindi Yojna Name"
                  name="hiname"
                  rules={[{ required: true, message: 'Please enter yojna name' }]}
                >
                  <Input 
                    placeholder="Enter hindi yojna name" 
                    className="h-10"
                  />
                </Form.Item>
                 <Form.Item
                  label="Gujrati Yojna Name"
                  name="guname"
                  rules={[{ required: true, message: 'Please enter yojna name' }]}
                >
                  <Input 
                    placeholder="Enter Gujrati yojna name" 
                    className="h-10"
                  />
                </Form.Item>
                <Form.Item
                  label="Certificate Note (Hindi)"
                  name="noteLine"
                >
                  <Input 
                    placeholder="Enter hindi note for certificate" 
                    className="h-10"
                  />
                </Form.Item>
                <Form.Item
                  label="About Program"
                  name="about"
                >
                  <TextArea
                    placeholder="Enter program description"
                    rows={3}
                    className="resize-none"
                  />
                </Form.Item>

                {/* isSelected Field */}
                <Form.Item
                  label={
                    <div className="flex items-center gap-2">
                      <FiTag className="text-orange-500" />
                      <span>Set as Selected Program</span>
                    </div>
                  }
                  name="isSelected"
                >
                  <Radio.Group 
                    value={isSelected}
                    onChange={(e) => setIsSelected(e.target.value)}
                    className="w-full"
                  >
                    <Space direction="horizontal">
                      <Radio value={true}>Yes</Radio>
                      <Radio value={false}>No</Radio>
                    </Space>
                  </Radio.Group>
                </Form.Item>

                {/* Program Category */}
                <Form.Item
                  label={
                    <div className="flex items-center gap-2">
                      <FiTag className="text-orange-500" />
                      <span>Program Category</span>
                    </div>
                  }
                  name="category"
                  rules={[{ required: true, message: 'Please select a category' }]}
                >
                  <Radio.Group className="w-full">
                    <Space direction="vertical" className="w-full">
                      {programCategories.map(cat => (
                        <Radio key={cat.value} value={cat.value}>
                          {cat.label}
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                </Form.Item>
              </Space>
            </Card>

            {/* Closing payment period */}
            <Card className="border border-gray-200">
              <Title level={5} className="!mb-1">Closing payment</Title>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <Form.Item label="Payment ke din (closing se)" name="dueDays" initialValue={45}
                  extra="Closing ke baad itne din mein payment bharna hai — uske baad 'late' ginega">
                  <InputNumber min={0} max={365} addonAfter="din" className="!w-full" />
                </Form.Item>
                <Form.Item label="Default kist (₹)" name="defaultPayAmount" initialValue={200}
                  extra="Jab age group se kist na mile">
                  <InputNumber min={0} max={100000} addonBefore="₹" className="!w-full" />
                </Form.Item>
              </div>
            </Card>

            {/* Member count display (kept mounted when the feature is off so the saved setting is not lost) */}
            <Card className="border border-gray-200" hidden={!countOn}>
              <Title level={5} className="!mb-1 flex items-center gap-2">
                <FiUser className="text-indigo-600" />
                Member count kaise dikhe
              </Title>
              <Text type="secondary" className="block !mb-4 text-xs">
                Dashboard aur yojna par members ki ginti kis tarah dikhani hai. Naye member judte hi ginti badhti rehti hai.
              </Text>
              <Form.Item name="countMode" initialValue="actual" className="!mb-3">
                <Radio.Group className="w-full">
                  <Space direction="vertical" className="w-full">
                    <Radio value="actual"><strong>Asli ginti</strong> — jitne member hain utne hi</Radio>
                    <Radio value="percent"><strong>Percent</strong> — asli ginti ka kuch % (jaise 1000 ka 70% = 700)</Radio>
                    <Radio value="fixed"><strong>Fixed ginti se shuru</strong> — jaise 600 dikhe, phir har naya member +1</Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>
              {countMode === 'percent' && (
                <Form.Item label="Kitne % dikhane hain" name="countPercent" initialValue={70}
                  rules={[{ required: true, message: 'Percent likhein' }]}>
                  <InputNumber min={1} max={1000} addonAfter="%" className="w-full" />
                </Form.Item>
              )}
              {countMode === 'fixed' && (
                <Form.Item label="Abhi kitni ginti dikhani hai" name="countFixed" initialValue={0}
                  tooltip="Save karte waqt jitne asli member hain, unke baad jo naye judenge woh isme judte jayenge."
                  rules={[{ required: true, message: 'Ginti likhein' }]}>
                  <InputNumber min={0} className="w-full" />
                </Form.Item>
              )}
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm flex flex-wrap gap-x-6 gap-y-1">
                <span>Asli abhi: <b>{realCount}</b></span>
                <span>Dikhega: <b className="text-indigo-700">{shownCount}</b></span>
                {countMode === 'fixed' && <span className="text-gray-500 text-xs">50 naye member judne par: {displayCount(realCount + 50, normalizeCountDisplay({ mode: 'fixed', fixed: countFixed }, mode === 'edit' ? program?.extra?.countDisplay : {}, realCount))}</span>}
              </div>
            </Card>

            {/* Registration Number Settings */}
            <Card className="border border-gray-200">
              <Title level={5} className="!mb-1 flex items-center gap-2">
                <FiHash className="text-green-600" />
                Registration Number
              </Title>
              <Text type="secondary" className="block !mb-4 text-xs">
                Har yojna ka apna reg. number format — prefix alag rakh sakte hain.
              </Text>

              <Form.Item
                label="Prefix"
                name="regPrefix"
                tooltip='Reg. number ke aage lagega. Jaise "MG" → MG000123. Khali bhi chhod sakte hain.'
              >
                <Input
                  placeholder="R"
                  className="h-10"
                  maxLength={6}
                  onChange={(e) =>
                    form.setFieldsValue({ regPrefix: e.target.value.toUpperCase() })
                  }
                />
              </Form.Item>

              <Form.Item label="Number Type" name="regMode">
                <Radio.Group className="w-full">
                  <Space direction="vertical" className="w-full">
                    <Radio value="series">
                      <strong>Series</strong> — 1, 2, 3 … kramvaar (recommended)
                    </Radio>
                    <Radio value="random">
                      <strong>Random</strong> — har baar naya random number
                    </Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>

              <div className="grid grid-cols-2 gap-4">
                <Form.Item
                  label="Digits"
                  name="regDigits"
                  tooltip="Kitne ank ka number ho. Series me zero se pad hoga (5 → 00042)."
                >
                  <InputNumber min={3} max={10} className="w-full h-10" />
                </Form.Item>

                {regMode === 'series' && (
                  <Form.Item
                    label="Start From"
                    name="regStartNo"
                    tooltip="Series is number se shuru hogi."
                  >
                    <InputNumber min={1} className="w-full h-10" />
                  </Form.Item>
                )}
              </div>

              {/* Live preview */}
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
                <Text type="secondary" className="text-xs block mb-1">
                  Agle members ko kuch aise number milenge:
                </Text>
                <Space wrap>
                  {regSamples.map((s, i) => (
                    <Tag key={i} color="green" className="font-mono !text-sm">{s}</Tag>
                  ))}
                </Space>
              </div>

              {mode === 'edit' && regMode === 'series' && issuedCounter > 0 && (
                <Alert
                  type="info"
                  showIcon
                  className="mt-3 text-xs"
                  message={`Is yojna me abhi tak ${issuedCounter} number issue ho chuke hain — series wahi se aage badhegi, "Start From" sirf tab lagta hai jab counter usse peeche ho.`}
                />
              )}

              {regMode === 'random' && (
                <Alert
                  type="warning"
                  showIcon
                  className="mt-3 text-xs"
                  message="Random me do members ko same number mil sakta hai. Series me aisa nahi hota — counter transaction ke andar badhta hai."
                />
              )}
            </Card>

            {/* Age Groups */}
            <Card className="border border-gray-200">
              <Title level={5} className="!mb-4 flex items-center gap-2">
                <FiCalendar className="text-blue-500" />
                Age Groups
              </Title>
              <Form.List name="ageGroups">
                {(fields, { add, remove }) => (
                  <div className="space-y-4">
                    {fields.map(field => (
                      <AgeGroupCard key={field.key} field={field} remove={remove} />
                    ))}
                    <Button 
                      type="dashed" 
                      onClick={() => add()} 
                      className="w-full h-12 flex items-center justify-center gap-2 !border-blue-200 hover:!border-blue-400"
                      icon={<FiPlusCircle />}
                    >
                      Add Age Group
                    </Button>
                  </div>
                )}
              </Form.List>
            </Card>

            {/* Location Groups */}
            <Card className="border border-gray-200">
              <Title level={5} className="!mb-4 flex items-center gap-2">
                <FiMapPin className="text-purple-500" />
                Location Groups
              </Title>
              <Form.List name="locationGroups">
                {(fields, { add, remove }) => (
                  <div className="space-y-4">
                    {fields.map(field => (
                      <LocationGroupCard key={field.key} field={field} remove={remove} />
                    ))}
                    <Button 
                      type="dashed" 
                      onClick={() => add()} 
                      className="w-full h-12 flex items-center justify-center gap-2 !border-purple-200 hover:!border-purple-400"
                      icon={<FiPlusCircle />}
                    >
                      Add Location Group
                    </Button>
                  </div>
                )}
              </Form.List>
            </Card>
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200">
            <div className="flex justify-end gap-3">
              <Button
                onClick={handleCloseDrawer}
                className="hover:bg-gray-50 px-6"
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                className="bg-blue-500 hover:bg-blue-600 px-6"
                loading={loading}
                icon={mode === 'edit' ? <FiSave /> : null}
              >
                {mode === 'edit' ? 'Update Program' : 'Create Program'}
              </Button>
            </div>
          </div>
        </Form>
      </Drawer>
    </>
  );
};

export default AddProgramEdit;