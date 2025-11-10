import React, { useState } from 'react';
import { Container, Card, Form, Button, Alert, Spinner, InputGroup } from 'react-bootstrap';
import { AlertCircle, Save, CheckCircle } from 'lucide-react';
import { apiCall } from '../App';

const ReceiveMaterial = () => {
  const [formData, setFormData] = useState({
    itemNo: '',
    location: 'FACTORY_6',
    scheduledQty: '', // ชื่อนี้คือ Qty รวม
    scheduledDateTime: '',
  });

  // State Loading 2 ตัว แยกกัน
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [loadingDirect, setLoadingDirect] = useState(false);
  
  // State สำหรับ Error/Success ของการ Submit
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // --- State ใหม่สำหรับ Validation ---
  const [itemStatus, setItemStatus] = useState({
    loading: false, // กำลังเช็ค Item
    error: '',      // Error จากการเช็ค
    name: ''        // ชื่อ Item ที่เจอ
  });
  // ---

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // ถ้าแก้ Item No, ให้เคลียร์ status เก่า
    if (name === 'itemNo') {
      setItemStatus({ loading: false, error: '', name: '' });
    }
  };

  // --- ฟังก์ชันใหม่: เช็ค Item No เมื่อคลิกออก (onBlur) ---
  const handleItemNoBlur = async () => {
    const itemNo = formData.itemNo.trim();
    if (!itemNo) return; // ถ้าช่องว่าง ก็ไม่ต้องทำ

    setItemStatus({ loading: true, error: '', name: '' });
    try {
      // ยิง API ใหม่ที่เราสร้าง
      const data = await apiCall(`/item-master/check/${itemNo}`);
      setItemStatus({ loading: false, error: '', name: data.ITEM_NAME }); // เจอ
    } catch (err) {
      // ไม่เจอ (404)
      setItemStatus({ loading: false, error: err.message, name: '' });
    }
  };

  // --- 1. ฟังก์ชันสำหรับปุ่ม "Schedule" ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoadingSchedule(true); 
    setError('');
    setSuccess('');

    const isoDateTime = new Date(formData.scheduledDateTime).toISOString();

    try {
      const response = await apiCall('/receive/schedule', {
        method: 'POST',
        body: JSON.stringify({
          itemNo: formData.itemNo,
          location: formData.location,
          scheduledQty: formData.scheduledQty,
          scheduledDateTime: isoDateTime
        }),
      });

      setSuccess(`Schedule ID: ${response.scheduleId} created successfully!`);
      // Reset form
      setFormData({ itemNo: '', location: 'FACTORY_6', scheduledQty: '', scheduledDateTime: '' });
      setItemStatus({ loading: false, error: '', name: '' }); // เคลียร์ status ด้วย

    } catch (err) {
      setError(err.message || 'Failed to create schedule');
    } finally {
      setLoadingSchedule(false);
    }
  };

  // --- 2. ฟังก์ชันสำหรับปุ่ม "Receive Now" ---
  const handleDirectReceive = async () => {
    setLoadingDirect(true);
    setError('');
    setSuccess('');

    if (!formData.itemNo || !formData.scheduledQty || parseFloat(formData.scheduledQty) <= 0) {
      setError('Please enter Item No and a valid Qty for Direct Receive.');
      setLoadingDirect(false);
      return;
    }

    try {
      await apiCall('/inventory/direct-receive', {
        method: 'POST',
        body: JSON.stringify({
          itemNo: formData.itemNo,
          location: formData.location,
          actualQty: formData.scheduledQty
        }),
      });

      setSuccess(`Direct Receive successful! Stock updated.`);
      // Reset form
      setFormData({ itemNo: '', location: 'FACTORY_6', scheduledQty: '', scheduledDateTime: '' });
      setItemStatus({ loading: false, error: '', name: '' }); // เคลียร์ status ด้วย

    } catch (err) {
      setError(err.message || 'Failed to process direct receive');
    } finally {
      setLoadingDirect(false);
    }
  };

  // Helper: ปุ่มจะถูก disable ถ้า (กำลังโหลด) หรือ (Item No ผิด)
  const isButtonDisabled = loadingSchedule || loadingDirect || itemStatus.loading || !!itemStatus.error;

  return (
    <Container className="py-4">
      <Card>
        <Card.Header>
          <Card.Title>ระบบรับเข้า Material</Card.Title>
        </Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="danger" onClose={() => setError('')} dismissible>
              <AlertCircle className="h-4 w-4 d-inline me-2" /> {error}
            </Alert>
          )}
          {success && (
            <Alert variant="success" onClose={() => setSuccess('')} dismissible>
              {success}
            </Alert>
          )}
          
          <Form onSubmit={handleSubmit}>
            
            <Form.Group className="mb-3">
              <Form.Label>Item No</Form.Label>
              <InputGroup>
                <Form.Control
                  type="text"
                  name="itemNo"
                  value={formData.itemNo}
                  onChange={handleInputChange}
                  onBlur={handleItemNoBlur} // <<-- เพิ่ม onBlur
                  placeholder="Enter Item No and click outside"
                  required
                  isInvalid={!!itemStatus.error} // <<-- แสดงกรอบแดงถ้า Error
                  isValid={!!itemStatus.name}   // <<-- แสดงกรอบเขียวถ้าเจอ
                />
                {itemStatus.loading && (
                  <InputGroup.Text><Spinner animation="border" size="sm" /></InputGroup.Text>
                )}
              </InputGroup>
              
              <Form.Control.Feedback type="invalid">
                {itemStatus.error}
              </Form.Control.Feedback>
              {itemStatus.name && (
                <Form.Text className="text-success">
                  {itemStatus.name}
                </Form.Text>
              )}
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Location</Form.Label>
              <Form.Select
                name="location"
                value={formData.location}
                onChange={handleInputChange}
              >
                <option value="FACTORY_6">Factory 6</option>
                <option value="FACTORY_7">Factory 7</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Quantity</Form.Label>
              <Form.Control
                type="number"
                name="scheduledQty"
                value={formData.scheduledQty}
                onChange={handleInputChange}
                placeholder="0.00"
                step="any"
                required
              />
            </Form.Group>

            <hr />

            {/* --- Option 1: Receive Now --- */}
            <h5 className="text-muted">Option 1: รับเข้าทันที</h5>
            <p className="text-muted small">ใช้ฟังก์ชันนี้หากต้องการรับเข้า Mat'l ทันที</p>
            <Button 
              type="button" 
              variant="success" 
              onClick={handleDirectReceive}
              disabled={isButtonDisabled || !formData.scheduledQty}
            >
              {loadingDirect ? (
                <Spinner as="span" animation="border" size="sm" />
              ) : (
                <CheckCircle className="h-4 w-4 d-inline me-2" />
              )}
              Receive
            </Button>

            <hr />

            {/* --- Option 2: Schedule --- */}
            <h5 className="text-muted">Option 2: รับเข้าล่วงหน้า</h5>
            <Form.Group className="mb-3">
              <Form.Label>วัน & เวลา ที่ของเจะเข้าล่วงหน้า</Form.Label>
              <Form.Control
                type="datetime-local"
                name="scheduledDateTime"
                value={formData.scheduledDateTime}
                onChange={handleInputChange}
              />
            </Form.Group>
            
            <Button 
              type="submit" 
              variant="primary" 
              className="me-2"
              disabled={isButtonDisabled || !formData.scheduledDateTime || !formData.scheduledQty}
            >
              {loadingSchedule ? (
                <Spinner as="span" animation="border" size="sm" />
              ) : (
                <Save className="h-4 w-4 d-inline me-2" />
              )}
              Set Schedule
            </Button>
          
            
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default ReceiveMaterial;