import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert, Spinner } from 'react-bootstrap';
import { AlertCircle } from 'lucide-react';
import { apiCall } from '../App';

const PendingReceiveModal = ({ show, item, onHide, onConfirmSuccess }) => {
  // `item` คือ item *ชิ้นแรก* ใน list ที่ค้าง
  
  const [actualQty, setActualQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // เมื่อ item (prop) เปลี่ยน, ให้อัปเดต state ของ Qty
  useEffect(() => {
    if (item) {
      setActualQty(item.SCHEDULED_QTY.toString());
    } else {
      setActualQty('');
    }
    setError(''); // Clear error on new item
  }, [item]);

  const handleConfirm = async () => {
    setLoading(true);
    setError('');

    if (actualQty === '' || isNaN(parseFloat(actualQty))) {
      setError('Please enter a valid actual quantity.');
      setLoading(false);
      return;
    }

    try {
      await apiCall(`/receive/confirm/${item.SCHEDULE_ID}`, {
        method: 'POST',
        body: JSON.stringify({
          actualQty: parseFloat(actualQty)
        }),
      });
      
      // บอก Component แม่ว่าสำเร็จแล้ว (เพื่อลบ item นี้ออกจาก list)
      onConfirmSuccess(); 

    } catch (err) {
      setError(err.message || 'Failed to confirm receive');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    // (ยังไม่ได้ทำ API Cancel, ตอนนี้ทำได้แค่กด Hide)
    onHide();
  };

  if (!item) return null; // ถ้าไม่มี item ก็ไม่ต้อง render modal

  return (
    <Modal show={show} onHide={onHide} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title className="text-warning">
          Pending Material Receive
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="danger">
            <AlertCircle className="h-4 w-4 d-inline me-2" />
            {error}
          </Alert>
        )}
        
        <h5>{item.ITEM_NO}</h5>
        <p className="text-muted">{item.ITEM_NAME || 'N/A'}</p>
        
        <p>
          <strong>Location:</strong> {item.LOCATION_NAME} <br />
          <strong>Scheduled Time:</strong> {new Date(item.SCHEDULED_DATETIME).toLocaleString()} <br />
          <strong>Scheduled Qty:</strong> {item.SCHEDULED_QTY}
        </p>

        <hr />
        
        <Form.Group>
          <Form.Label>
            <strong>Actual Received Qty (ที่เหลือ):</strong>
          </Form.Label>
          <Form.Control
            type="number"
            value={actualQty}
            onChange={(e) => setActualQty(e.target.value)}
            step="any"
            placeholder="Enter actual received qty"
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleCancel}>
          Later
        </Button>
        <Button variant="primary" onClick={handleConfirm} disabled={loading}>
          {loading && <Spinner as="span" animation="border" size="sm" />}
          Confirm Receive
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default PendingReceiveModal;