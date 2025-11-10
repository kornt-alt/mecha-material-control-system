import React, { useState } from 'react';
import { Container, Card, Form, Button, Alert, Spinner, InputGroup, ListGroup, Badge } from 'react-bootstrap';
import { AlertCircle, ArrowRightLeft } from 'lucide-react';
import { apiCall } from '../App';

const TransferMaterial = () => {
  const [formData, setFormData] = useState({
    itemNo: '',
    locationFrom: 'FACTORY 6',
    locationTo: 'FACTORY 7',
    transferQty: '',
  });
  
  const [loading, setLoading] = useState(false); // Loading สำหรับ Submit
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // --- State ใหม่สำหรับ Validation ---
  const [itemStatus, setItemStatus] = useState({
    loading: false, // กำลังเช็ค Item
    error: '',      // Error จากการเช็ค
    stock: []       // [ { LOCATION_NAME: "F6", QTY: 100 }, ... ]
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
      setItemStatus({ loading: false, error: '', stock: [] });
    }
  };

  // --- ฟังก์ชันใหม่: เช็ค Stock เมื่อคลิกออก (onBlur) ---
  const handleItemNoBlur = async () => {
    const itemNo = formData.itemNo.trim();
    if (!itemNo) return;

    setItemStatus({ loading: true, error: '', stock: [] });
    try {
      // ยิง API ใหม่
      const data = await apiCall(`/inventory/stock/${itemNo}`);
      setItemStatus({ loading: false, error: '', stock: data }); // เจอ
    } catch (err) {
      // ไม่เจอ (404)
      setItemStatus({ loading: false, error: err.message, stock: [] });
    }
  };

  // --- ฟังก์ชันสำหรับ Submit ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (formData.locationFrom === formData.locationTo) {
      setError('From and To locations cannot be the same.');
      setLoading(false);
      return;
    }
    if (parseFloat(formData.transferQty) <= 0) {
      setError('Transfer QTY must be greater than 0.');
      setLoading(false);
      return;
    }

    try {
      await apiCall('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      setSuccess(`Transfer successful!`);
      // Reset form
      setFormData({ itemNo: '', locationFrom: 'FACTORY_6', locationTo: 'FACTORY_7', transferQty: '' });
      setItemStatus({ loading: false, error: '', stock: [] }); // เคลียร์ status

    } catch (err) {
      setError(err.message || 'Failed to transfer stock');
    } finally {
      setLoading(false);
    }
  };

  // Helper: ปุ่มจะถูก disable ถ้า (กำลังโหลด) หรือ (Item No ผิด/ไม่มีของ)
  const isButtonDisabled = loading || itemStatus.loading || !!itemStatus.error || itemStatus.stock.length === 0;

  return (
    <Container className="py-4">
      <Card>
        <Card.Header>
          <Card.Title>Transfer Mat'l Locations</Card.Title>
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
                  isInvalid={!!itemStatus.error}
                  isValid={itemStatus.stock.length > 0}
                />
                {itemStatus.loading && (
                  <InputGroup.Text><Spinner animation="border" size="sm" /></InputGroup.Text>
                )}
              </InputGroup>
              
              <Form.Control.Feedback type="invalid">
                {itemStatus.error}
              </Form.Control.Feedback>
              
              {itemStatus.stock.length > 0 && (
                <ListGroup className="mt-2">
                  <ListGroup.Item variant="info">
                    <strong>Current Stock:</strong>
                  </ListGroup.Item>
                  {itemStatus.stock.map(s => (
                    <ListGroup.Item key={s.LOCATION_NAME} className="d-flex justify-content-between">
                      {s.LOCATION_NAME}
                      <Badge bg={s.QTY <= 0 ? "danger" : "primary"} pill>
                        QTY: {s.QTY}
                      </Badge>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Transfer Qty</Form.Label>
              <Form.Control
                type="number"
                name="transferQty"
                value={formData.transferQty}
                onChange={handleInputChange}
                placeholder="0.00"
                step="any"
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>จาก Location (Form)</Form.Label>
              <Form.Select
                name="locationFrom"
                value={formData.locationFrom}
                onChange={handleInputChange}
              >
                <option value="FACTORY_6">Factory 6</option>
                <option value="FACTORY_7">Factory 7</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>ไป Location (To)</Form.Label>
              <Form.Select
                name="locationTo"
                value={formData.locationTo}
                onChange={handleInputChange}
              >
                <option value="FACTORY_7">Factory 7</option>
                <option value="FACTORY_6">Factory 6</option>
              </Form.Select>
            </Form.Group>

            <Button 
              type="submit" 
              variant="warning" 
              disabled={isButtonDisabled || !formData.transferQty}
            >
              {loading ? (
                <Spinner as="span" animation="border" size="sm" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 d-inline me-2" />
              )}
              Transfer
            </Button>
            
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default TransferMaterial;