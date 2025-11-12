import React, { useState, useEffect, useMemo } from 'react'; // <-- เพิ่ม
import { Container, Card, Form, Button, Alert, Spinner, InputGroup, ListGroup, Row, Col, Badge } from 'react-bootstrap'; // <-- เพิ่ม
import { ArrowRightLeft } from 'lucide-react';
import { apiCall } from '../../App';

const TransferMaterial = () => {
  // 1. แยก State
  const [itemNo, setItemNo] = useState('');
  const [transferQty, setTransferQty] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [itemStatus, setItemStatus] = useState({
    loading: false,
    error: '',
    stock: []
  });

  // --- 2. State ใหม่สำหรับ Location (Dropdown 2 ชุด) ---
  const [allLocations, setAllLocations] = useState([]);
  const [loadingLoc, setLoadingLoc] = useState(false);

  // ชุดที่ 1: FROM
  const [locationFrom, setLocationFrom] = useState('');
  const [subLocationFrom, setSubLocationFrom] = useState('');
  
  // ชุดที่ 2: TO
  const [locationTo, setLocationTo] = useState('');
  const [subLocationTo, setSubLocationTo] = useState('');
  // ---------------------------------------------------

  // 3. ดึง Location List
  useEffect(() => {
    const fetchLocations = async () => {
      setLoadingLoc(true);
      try {
        const locData = await apiCall('/locations');
        setAllLocations(locData);
      } catch (err) {
        setError('Failed to load locations list');
      } finally {
        setLoadingLoc(false);
      }
    };
    fetchLocations();
  }, []);

  // 4. Logic สร้าง Dropdown (ต้องมี 2 ชุด)
  const locationOptions = useMemo(() => {
    const uniqueLocations = [...new Set(allLocations.map(loc => loc.LOCATION_NAME))];
    return uniqueLocations.sort();
  }, [allLocations]);

  const subLocationOptionsFrom = useMemo(() => {
    if (!locationFrom) return [];
    return allLocations
      .filter(loc => loc.LOCATION_NAME === locationFrom)
      .map(loc => loc.SUB_LOCATION)
      .sort();
  }, [allLocations, locationFrom]);
  
  const subLocationOptionsTo = useMemo(() => {
    if (!locationTo) return [];
    return allLocations
      .filter(loc => loc.LOCATION_NAME === locationTo)
      .map(loc => loc.SUB_LOCATION)
      .sort();
  }, [allLocations, locationTo]);

  // Handler (ต้องมี 2 ชุด)
  const handleLocationFromChange = (e) => {
    setLocationFrom(e.target.value);
    setSubLocationFrom('');
  };
  const handleLocationToChange = (e) => {
    setLocationTo(e.target.value);
    setSubLocationTo('');
  };
  // -------------------------------------------

  const handleItemNoChange = (e) => {
    setItemNo(e.target.value);
    setItemStatus({ loading: false, error: '', stock: [] });
  };

  const handleItemNoBlur = async () => {
    const trimmedItemNo = itemNo.trim();
    if (!trimmedItemNo) return;

    setItemStatus({ loading: true, error: '', stock: [] });
    try {
      // (API นี้ต้องแก้ให้ดึง Sub Location มาด้วย)
      const data = await apiCall(`/inventory/stock/${trimmedItemNo}`);
      setItemStatus({ loading: false, error: '', stock: data });
    } catch (err) {
      setItemStatus({ loading: false, error: err.message, stock: [] });
    }
  };

  // 5. อัปเกรด handleSubmit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (locationFrom === locationTo && subLocationFrom === subLocationTo) {
      setError('From and To locations cannot be the same.');
      setLoading(false);
      return;
    }
    if (parseFloat(transferQty) <= 0) {
      setError('Transfer QTY must be greater than 0.');
      setLoading(false);
      return;
    }
    // (แก้ไข) เอา !subLocation ออก
    if (!itemNo || !locationFrom || !locationTo) {
      setError('Please fill Item No, From Location, and To Location.');
      setLoading(false);
      return;
    }

    try {
      await apiCall('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({
          itemNo: itemNo,
          transferQty: transferQty,
          locationFrom: locationFrom,
          subLocationFrom: subLocationFrom, // (ส่ง '' (ค่าว่าง) ถ้าไม่เลือก)
          locationTo: locationTo,
          subLocationTo: subLocationTo     // (ส่ง '' (ค่าว่าง) ถ้าไม่เลือก)
        }),
      });

      setSuccess(`Transfer successful!`);
      // Reset form
      setItemNo('');
      setTransferQty('');
      setLocationFrom('');
      setSubLocationFrom('');
      setLocationTo('');
      setSubLocationTo('');
      setItemStatus({ loading: false, error: '', stock: [] });

    } catch (err) {
      setError(err.message || 'Failed to transfer stock');
    } finally {
      setLoading(false);
    }
  };

  const isButtonDisabled = loading || itemStatus.loading || !!itemStatus.error || loadingLoc;

  return (
    <Container className="py-4">
      <Card>
        <Card.Header>
          <Card.Title>Transfer Mat'l Locations</Card.Title>
        </Card.Header>
        <Card.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}
          
          <Form onSubmit={handleSubmit}>
            
            <Form.Group className="mb-3">
              <Form.Label>Item No</Form.Label>
              <InputGroup>
                <Form.Control
                  type="text"
                  name="itemNo"
                  value={itemNo}
                  onChange={handleItemNoChange}
                  onBlur={handleItemNoBlur}
                  required
                />
                {itemStatus.loading && (
                  <InputGroup.Text>
                    <Spinner animation="border" size="sm" />
                  </InputGroup.Text>
                )}
              </InputGroup>
              {itemStatus.stock.length > 0 && (
                <ListGroup className="mt-2" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  <ListGroup.Item variant="info">
                    <strong>Current Stock:</strong>
                  </ListGroup.Item>
                  {itemStatus.stock.map(s => (
                    <ListGroup.Item key={`${s.LOCATION_NAME}-${s.SUB_LOCATION || 'default'}`}>
                      <div>
                        {s.LOCATION_NAME} / 
                        {/* (แก้ไข) แสดง DEFAULT ถ้าไม่มี */}
                        <strong className="ms-1">{s.SUB_LOCATION || 'DEFAULT'}</strong>
                      </div>
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
                value={transferQty}
                onChange={(e) => setTransferQty(e.target.value)}
                required
              />
            </Form.Group>

            <hr />

            {/* --- 6. Dropdown (FROM) --- */}
            <h5>From Location</h5>
            {loadingLoc ? <Spinner /> : (
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Location</Form.Label>
                    <Form.Select 
                      value={locationFrom} 
                      onChange={handleLocationFromChange}
                    >
                      <option value="">-- Select Location --</option>
                      {locationOptions.map(locName => (
                        <option key={`from-${locName}`} value={locName}>{locName}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Sub Location</Form.Label>
                    <Form.Select 
                      value={subLocationFrom} 
                      onChange={(e) => setSubLocationFrom(e.target.value)}
                      disabled={!locationFrom}
                    >
                      {/* (แก้ไข) เปลี่ยน Text */}
                      <option value="">-- DEFAULT --</option>
                      {subLocationOptionsFrom.map(subLocName => (
                        <option key={`from-sub-${subLocName}`} value={subLocName}>{subLocName}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            )}

            <hr />

            {/* --- 7. Dropdown (TO) --- */}
            <h5>To Location</h5>
            {loadingLoc ? <Spinner /> : (
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Location</Form.Label>
                    <Form.Select 
                      value={locationTo} 
                      onChange={handleLocationToChange}
                    >
                      <option value="">-- Select Location --</option>
                      {locationOptions.map(locName => (
                        <option key={`from-${locName}`} value={locName}>{locName}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Sub Location</Form.Label>
                    <Form.Select 
                      value={subLocationTo} 
                      onChange={(e) => setSubLocationTo(e.target.value)}
                      disabled={!locationTo}
                    >
                      {/* (แก้ไข) เปลี่ยน Text */}
                      <option value="">-- DEFAULT --</option>
                      {subLocationOptionsTo.map(subLocName => (
                        <option key={`to-sub-${subLocName}`} value={subLocName}>{subLocName}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            )}
            
            <Button 
              type="submit" 
              variant="warning" 
              disabled={isButtonDisabled || !transferQty}
            >
              {loading ? <Spinner /> : <ArrowRightLeft />}
              Transfer
            </Button>
            
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default TransferMaterial;