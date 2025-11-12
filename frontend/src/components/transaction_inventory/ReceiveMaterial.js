import React, { useState, useEffect, useMemo } from 'react';
import { Container, Card, Form, Button, Alert, Spinner, InputGroup, Row, Col } from 'react-bootstrap';
import { Save, CheckCircle } from 'lucide-react';
import { apiCall } from '../../App';

const ReceiveMaterial = () => {
  const [formData, setFormData] = useState({
    itemNo: '',
    scheduledQty: '',
    scheduledDateTime: '',
  });

  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [loadingDirect, setLoadingDirect] = useState(false);
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [itemStatus, setItemStatus] = useState({
    loading: false,
    error: '',
    name: '',
    spec: ''
  });

  const [allLocations, setAllLocations] = useState([]);
  const [loadingLoc, setLoadingLoc] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedSubLocation, setSelectedSubLocation] = useState('');

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

  const locationOptions = useMemo(() => {
    const uniqueLocations = [...new Set(allLocations.map(loc => loc.LOCATION_NAME))];
    return uniqueLocations.sort();
  }, [allLocations]);

  const subLocationOptions = useMemo(() => {
    if (!selectedLocation) return [];
    return allLocations
      .filter(loc => loc.LOCATION_NAME === selectedLocation)
      .map(loc => loc.SUB_LOCATION)
      .sort();
  }, [allLocations, selectedLocation]);
  
  const handleLocationChange = (e) => {
    setSelectedLocation(e.target.value);
    setSelectedSubLocation('');
  };

  const resetForm = () => {
    setFormData({ itemNo: '', scheduledQty: '', scheduledDateTime: '' });
    setItemStatus({ loading: false, error: '', name: '', spec: '' });
    setSelectedLocation('');
    setSelectedSubLocation('');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'itemNo') {
      setItemStatus({ loading: false, error: '', name: '', spec: '' });
    }
  };

  const handleItemNoBlur = async () => {
    const itemNo = formData.itemNo.trim();
    if (!itemNo) return;
    setItemStatus({ loading: true, error: '', name: '', spec: '' });
    try {
      const data = await apiCall(`/item-master/check/${itemNo}`);
      setItemStatus({ loading: false, error: '', name: data.ITEM_NAME, spec: data.SPEC });
    } catch (err) {
      setItemStatus({ loading: false, error: err.message, name: '', spec: '' });
    }
  };

  // --- 4. (FIXED) handleSubmit (Schedule) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoadingSchedule(true);
    setError('');
    setSuccess('');

    if (!selectedLocation) {
      setError('Please select a Location.');
      setLoadingSchedule(false);
      return;
    }

    const isoDateTime = new Date(formData.scheduledDateTime).toISOString();
    try {
      const response = await apiCall('/receive/schedule', {
        method: 'POST',
        body: JSON.stringify({
          itemNo: formData.itemNo,
          location: selectedLocation,
          subLocation: selectedSubLocation, // (ส่ง Sub Location ไปด้วย)
          scheduledQty: formData.scheduledQty,
          scheduledDateTime: isoDateTime
        }),
      });
      // ---------------------------------

      setSuccess(`Schedule ID: ${response.scheduleId} created successfully!`);
      resetForm();

    } catch (err) {
      setError(err.message || 'Failed to create schedule');
    } finally {
      setLoadingSchedule(false);
    }
  };

  // --- 5. handleDirectReceive (ถูกต้อง) ---
  const handleDirectReceive = async () => {
  setLoadingDirect(true);
  setError('');
  setSuccess('');

  if (!formData.itemNo || !formData.scheduledQty || parseFloat(formData.scheduledQty) <= 0) {
    setError('Please enter Item No and a valid Qty.');
    setLoadingDirect(false);
    return;
  }
  
  if (!selectedLocation) {
    setError('Please select a Location for Direct Receive.');
    setLoadingDirect(false);
    return;
  }

  try {
    await apiCall('/inventory/direct-receive', {
      method: 'POST',
      body: JSON.stringify({
        itemNo: formData.itemNo,
        locationName: selectedLocation,
        subLocation: selectedSubLocation, 
        actualQty: formData.scheduledQty
      }),
    });

    setSuccess(`Direct Receive successful! Stock updated.`);
    resetForm();
  } catch (err) {
    setError(err.message || 'Failed to process direct receive');
  } finally {
    setLoadingDirect(false);
  }
};

  const isButtonDisabled = loadingSchedule || loadingDirect || itemStatus.loading || !!itemStatus.error || loadingLoc;

  return (
    <Container className="py-4">
      <Card>
        <Card.Header>
          <Card.Title>ระบบรับเข้า Material</Card.Title>
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
                  value={formData.itemNo}
                  onChange={handleInputChange}
                  onBlur={handleItemNoBlur}
                  placeholder="ระบุ Item No ที่ต้องการเพิ่ม"
                  required
                  isInvalid={!!itemStatus.error}
                  isValid={!!itemStatus.name}
                />
                {itemStatus.loading && <InputGroup.Text><Spinner animation="border" size="sm" /></InputGroup.Text>}
              </InputGroup>
              <Form.Control.Feedback type="invalid">{itemStatus.error}</Form.Control.Feedback>
              {itemStatus.name && <Form.Text className="text-success">{itemStatus.name}</Form.Text>}
              {itemStatus.spec && <Form.Text className="text-muted d-block">Spec: {itemStatus.spec}</Form.Text>}
            </Form.Group>

            {loadingLoc ? (
              <div className="text-center"><Spinner /></div>
            ) : (
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Location</Form.Label>
                    <Form.Select
                      value={selectedLocation}
                      onChange={handleLocationChange}
                      isInvalid={!!error && !selectedLocation}
                    >
                      <option value="">-- Select Location --</option>
                      {locationOptions.map(locName => (
                        <option key={locName} value={locName}>{locName}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Sub Location</Form.Label>
                    <Form.Select
                      value={selectedSubLocation}
                      onChange={(e) => setSelectedSubLocation(e.target.value)}
                      disabled={!selectedLocation}
                    >
                      <option value="">-- DEFAULT --</option> 
                      {subLocationOptions.map(subLocName => (
                        <option key={subLocName} value={subLocName}>{subLocName}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            )}
            
            <Form.Group className="mb-3">
              <Form.Label>Quantity</Form.Label>
              <Form.Control
                type="number"
                name="scheduledQty"
                value={formData.scheduledQty}
                onChange={handleInputChange}
                required
              />
            </Form.Group>

            <hr />

            <h5 className="text-muted">Option 1: รับเข้าทันที</h5>
            <Button 
              type="button" 
              variant="success" 
              onClick={handleDirectReceive}
              disabled={isButtonDisabled || !formData.scheduledQty}
            >
              {loadingDirect ? <Spinner as="span" animation="border" size="sm" /> : <CheckCircle className="h-4 w-4 d-inline me-2" />}
              Receive
            </Button>

            <hr />

            <h5 className="text-muted">Option 2: รับเข้าล่วงหน้า</h5>
            <Form.Group className="mb-3">
              <Form.Label>วัน & เวลา ที่ของจะเข้าล่วงหน้า</Form.Label>
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
              disabled={isButtonDisabled || !formData.scheduledDateTime || !formData.scheduledQty}
            >
              {loadingSchedule ? <Spinner as="span" animation="border" size="sm" /> : <Save className="h-4 w-4 d-inline me-2" />}
              Set Schedule
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default ReceiveMaterial;