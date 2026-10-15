import React, { useState } from 'react';
import { Button } from 'antd';
import { FiPlusCircle } from 'react-icons/fi';
import AddProgramEdit from './AddProgramEdit';

// "Add Yojna": the same full form as Edit (reg. number format, member count display, closing
// payment days, age / location groups) — one form for both, so nothing is missing when adding.
const AddProgram = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="primary" size="medium" icon={<FiPlusCircle className="mr-2" />} onClick={() => setOpen(true)}>
        Add Yojna
      </Button>
      <AddProgramEdit mode="add" isDrawerOpen={open} setIsDrawerOpen={setOpen} />
    </>
  );
};

export default AddProgram;
