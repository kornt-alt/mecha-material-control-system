import React, { useState, useEffect, useCallback } from 'react';
import { Container, Card, Spinner, Alert, Row, Col, Form, InputGroup, Button } from 'react-bootstrap'; // เพิ่ม Form, InputGroup, Button
import { Archive, Search, XCircle } from 'lucide-react'; // เพิ่ม Search, XCircle
import { apiCall } from '../../App'; 
import { useDebounce } from '../hooks/useDebounce';

const InventoryView = () => {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // --- State ใหม่สำหรับ Search/Filter ---
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('ALL');
  
  // ใช้ Debounce สำหรับ Search
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: debouncedSearchTerm,
        location: locationFilter,
      });
      
      const data = await apiCall(`/inventory/stock?${params.toString()}`);
      setStock(data);
    } catch (err) {
      setError(err.message || 'Failed to fetch stock data');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchTerm, locationFilter]); // Re-fetch เมื่อค่า 2 นี้เปลี่ยน

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const [allLocations, setAllLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);

  useEffect(() => {
    const fetchLocations = async () => {
      setLoadingLocations(true);
      try {
        const locData = await apiCall('/locations'); // ← ตรงกับ API ที่คุณมี
        const uniqueLocs = [...new Set(locData.map(loc => loc.LOCATION_NAME))].sort();
        setAllLocations(uniqueLocs);
      } catch (err) {
        setError('Failed to load location list');
      } finally {
        setLoadingLocations(false);
      }
    };
    fetchLocations();
  }, []);

  const resetFilters = () => {
    setSearchTerm('');
    setLocationFilter('ALL');
  };

  // --- ฟังก์ชันสำหรับกำหนดสี Card ---
  const getCardStyle = (qty) => {
    if (qty <= 0) {
      return { border: '2px solid #dc3545', bg: 'light' }; // Red border
    }
    if (qty < 100) {
      return { border: '2px solid #ffc107', bg: 'light' }; // Warning border
    }
    return { border: undefined, bg: undefined }; // Normal
  };
  
  // --- ฟังก์ชันสำหรับกำหนดสี Text QTY ---
  const getQtyTextStyle = (qty) => {
    if (qty <= 0) return 'text-danger fw-bold';
    if (qty < 100) return 'text-warning fw-bold';
    return '';
  };

  return (
    <Container className="py-4">
      <h2 className="mb-4">
        <Archive className="h-6 w-6 d-inline me-2" />
        Inventory Stock
      </h2>
      
      {/* --- Search/Filter Form --- */}
      <Card className="mb-4">
        <Card.Body>
          <Form onSubmit={(e) => e.preventDefault()}>
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>Search (Item No / Name / Sub Location)</Form.Label> {/* <-- แก้ Text */}
                <InputGroup>
                  <InputGroup.Text><Search size={16} /></InputGroup.Text>
                  <Form.Control
                    type="text"
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </InputGroup>
              </Col>
              <Col md={4}>
                <Form.Label>Filter by Location</Form.Label>
                <Form.Select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  disabled={loadingLocations}
                >
                  <option value="ALL">All Locations</option>
                  {allLocations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </Form.Select>
              </Col>
            </Row>
            <Button
              variant="outline-secondary"
              onClick={resetFilters}
              disabled={searchTerm === '' && locationFilter === 'ALL'}
            >
              <XCircle size={16} className="me-1" />
              Reset Filters
            </Button>
          </Form>
        </Card.Body>
      </Card>
      
      {/* --- Stock Display --- */}
      {error && <Alert variant="danger">{error}</Alert>}
      
      {loading ? (
        <div className="text-center"><Spinner /></div>
      ) : (
        <Row xs={1} md={2} lg={4} className="g-4">
          {stock.length === 0 ? (
            <Col>
              <p className="text-muted">No stock available for this criteria.</p>
            </Col>
          ) : (
            stock.map((item, index) => { // <-- item มี SUB_LOCATION แล้ว
              const cardStyle = getCardStyle(item.QTY);
              const textStyle = getQtyTextStyle(item.QTY);
              
              return (
                <Col key={index}>
                  <Card 
                    className="h-100" 
                    border={cardStyle.border ? cardStyle.border.split(' ')[2] : undefined}
                    bg={cardStyle.bg}
                    style={{ borderWidth: cardStyle.border ? '2px' : '1px' }}
                  >
                    <Card.Body>
                      <Card.Title>{item.ITEM_NO}</Card.Title>
                      <Card.Subtitle className="mb-2 text-muted">
                        {item.ITEM_NAME || 'N/A'}
                      </Card.Subtitle>
                      <hr />
                      <Card.Text>
                        <strong>Location:</strong> {item.LOCATION_NAME}
                        <br />
                        {/* --- (แก้ไข) แสดงผล Sub Location --- */}
                        <strong>Sub Location:</strong> {item.SUB_LOCATION || 'DEFAULT'}
                        <br />
                        <strong className={textStyle}>
                          QTY: {parseFloat(item.QTY).toFixed(2)}
                        </strong>
                      </Card.Text>
                    </Card.Body>
                  </Card>
                </Col>
              );
            })
          )}
        </Row>
      )}
    </Container>
  );
};

export default InventoryView;