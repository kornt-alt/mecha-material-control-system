import React, { useState } from 'react';
import { Container, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { AlertCircle, PlusCircle, CheckCircle } from 'lucide-react';
import { apiCall } from '../../App';

const AddLocation = () => {
  const [formData, setFormData] = useState({
    locationName: '',
    subLocation: '',
    division: '',
    description: '',
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    // (Validate)
    // --- [FIX] แก้ไข Validation และ Error Message ---
    if (!formData.locationName || !formData.division) {
      setError('Location Name and Division are required.'); // <-- [FIX]
      setLoading(false);
      return;
    }
    // ----------------------------------------

    try {
      // (formData.subLocation จะเป็น '' (ค่าว่าง) ถ้าไม่กรอก ซึ่งถูกต้อง)
      await apiCall('/locations', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      setSuccess(`Location ${formData.locationName}/${formData.subLocation || 'DEFAULT'} added successfully!`);
      // Reset form
      setFormData({ locationName: '', subLocation: '', division: '', description: '' });

    } catch (err) {
      setError(err.message || 'Failed to add location');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="py-4">
      <Card>
        <Card.Header>
          <Card.Title>
            <PlusCircle className="h-5 w-5 d-inline me-2" />
            Add New Location (Master)
          </Card.Title>
        </Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="danger" onClose={() => setError('')} dismissible>
              <AlertCircle className="h-4 w-4 d-inline me-2" /> {error}
            </Alert>
          )}
          {success && (
            <Alert variant="success" onClose={() => setSuccess('')} dismissible>
              <CheckCircle className="h-4 w-4 d-inline me-2" /> {success}
            </Alert>
          )}
          
          <Form onSubmit={handleSubmit}>
            
            <Form.Group className="mb-3">
              <Form.Label>Location Name</Form.Label>
              <Form.Control
                type="text"
                name="locationName"
                value={formData.locationName}
                onChange={handleInputChange}
                placeholder="e.g., FACTORY_6"
                required
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Sub Location (Optional)</Form.Label>
              <Form.Control
                type="text"
                name="subLocation"
                value={formData.subLocation}
                onChange={handleInputChange}
                placeholder="e.g., RACK-A-01 (Leave blank for DEFAULT)" // <-- [FIX] แก้ Placeholder
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Division</Form.Label>
              <Form.Select
                name="division"
                value={formData.division}
                onChange={handleInputChange}
                required
              >
                <option value="">-- Select Division --</option>
                <option value="M/P 1">M/P 1</option>
                <option value="M/P 2">M/P 2</option>
                <option value="Common">Common</option>
                {/* (เพิ่ม Division อื่นๆ ตามต้องการ) */}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description (Optional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="e.g., Shelf for raw materials"
              />
            </Form.Group>

            <Button 
              type="submit" 
              variant="primary" 
              disabled={loading}
            >
              {loading ? (
                <Spinner as="span" animation="border" size="sm" />
              ) : (
                <PlusCircle className="h-4 w-4 d-inline me-2" />
              )}
              Add Location
            </Button>
            
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default AddLocation;