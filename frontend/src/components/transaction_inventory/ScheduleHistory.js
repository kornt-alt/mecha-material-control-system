import React, { useState, useEffect, useCallback } from 'react';
import { Container, Table, Alert, Spinner, Form, InputGroup, Button, Pagination, Badge } from 'react-bootstrap';
import { ArrowUp, ArrowDown, CalendarCheck, Inbox, Trash2 } from 'lucide-react';
import { apiCall } from '../../App';
import { useDebounce } from '../hooks/useDebounce';
import PendingReceiveModal from './PendingReceiveModal';

const ScheduleHistory = () => {
  const [schedules, setSchedules] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // (State ที่คุณเพิ่มมา ถูกต้องแล้ว)
  const [success, setSuccess] = useState('');
  const [loadingCancel, setLoadingCancel] = useState(null); 
  
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'SCHEDULED_DATETIME', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const fetchScheduleData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('limit', itemsPerPage);
        if (debouncedSearchTerm.trim() !== '') {
          params.set('search', debouncedSearchTerm.trim());
        }
        params.set('sortKey', sortConfig.key);
        params.set('sortDir', sortConfig.direction);

      const response = await apiCall(`/receive/schedules?${params.toString()}`);
      
      setSchedules(response.data);
      setTotalCount(response.totalCount || 0);
      setError('');
    } catch (err) {
      setError('Failed to fetch schedule history');
      setSchedules([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedSearchTerm, sortConfig, itemsPerPage]);

  useEffect(() => {
    fetchScheduleData();
  }, [fetchScheduleData]);

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };
  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };
  const resetFilters = () => {
    setSearchTerm('');
    setSortConfig({ key: 'SCHEDULED_DATETIME', direction: 'desc' });
    setCurrentPage(1);
  };
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const indexOfFirstItem = (currentPage - 1) * itemsPerPage;
  const indexOfLastItem = Math.min(indexOfFirstItem + itemsPerPage, totalCount);
  const generatePaginationItems = () => {
     const items = [];
     const maxVisiblePages = 5;
     if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        items.push(<Pagination.Item key={i} active={i === currentPage} onClick={() => handlePageChange(i)}>{i}</Pagination.Item>);
        }
      } else {
        items.push(<Pagination.Item key={1} active={1 === currentPage} onClick={() => handlePageChange(1)}>1</Pagination.Item>);
        if (currentPage > 3) {
          items.push(<Pagination.Ellipsis key="start-ellipsis" />);
        }
        const startPage = Math.max(2, currentPage - 1);
        const endPage = Math.min(totalPages - 1, currentPage + 1);
        for (let i = startPage; i <= endPage; i++) {
          items.push(<Pagination.Item key={i} active={i === currentPage} onClick={() => handlePageChange(i)}>{i}</Pagination.Item>);
        }
        if (currentPage < totalPages - 2) {
          items.push(<Pagination.Ellipsis key="end-ellipsis" />);
        }
        items.push(<Pagination.Item key={totalPages} active={totalPages === currentPage} onClick={() => handlePageChange(totalPages)}>{totalPages}</Pagination.Item>);
      }
      return items;
  };
  // ... (จบส่วนโค้ดเดิม) ...

  const handleShowReceiveModal = (item) => {
    setSelectedItem(item);
    setShowReceiveModal(true);
  };

  const handleHideReceiveModal = () => {
    setSelectedItem(null);
    setShowReceiveModal(false);
  };

  const handleConfirmSuccess = () => {
    handleHideReceiveModal();
    fetchScheduleData();
  };

  // (ฟังก์ชัน handleCancel ที่คุณเพิ่มมา ถูกต้องแล้ว)
  const handleCancel = async (scheduleId) => {
    if (!window.confirm('Are you sure you want to cancel this schedule? This action cannot be undone.')) {
      return;
    }
    
    setLoadingCancel(scheduleId);
    setError('');
    setSuccess('');
    
    try {
      await apiCall(`/receive/cancel/${scheduleId}`, { method: 'POST' });
      setSuccess('Schedule cancelled successfully.');
      fetchScheduleData(); 
      
    } catch (err) {
      setError(err.message || 'Failed to cancel schedule');
    } finally {
      setLoadingCancel(null);
    }
  };

  // (Helper functions ถูกต้องแล้ว)
  const renderStatusBadge = (status) => {
    if (status === 'CONFIRMED') {
      return <Badge bg="success">Confirmed</Badge>;
    }
    if (status === 'PENDING') {
      return <Badge bg="warning" text="dark">Pending</Badge>;
    }
    // (เพิ่ม Cancelled)
    if (status === 'CANCELLED') { 
      return <Badge bg="danger">Cancelled</Badge>;
    }
    return <Badge bg="secondary">{status}</Badge>; 
  };
  const formatDateTime = (isoString) => {
    if (!isoString) return <span className="text-muted">-</span>;
    return new Date(isoString).toLocaleString('th-TH');
  };
  const formatQty = (qty) => {
    if (qty === null || qty === undefined) return <span className="text-muted">-</span>;
    return parseFloat(qty).toFixed(2);
  };
  // ...


  return (
    <Container className="py-6" style={{ maxWidth: '95%' }}>
      <h2 className="text-2xl font-bold mb-4">
        <CalendarCheck className="h-6 w-6 d-inline me-2" />
        Schedule & Receive History
      </h2>

      {/* --- [FIX 1] เพิ่ม Alert สำหรับ Success และ Error --- */}
      {error && (
        <Alert variant="danger" onClose={() => setError('')} dismissible>
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" onClose={() => setSuccess('')} dismissible>
          {success}
        </Alert>
      )}
      {/* ------------------------------------------- */}

      {/* ... (Form Search และ Showing entries ... ถูกต้อง) ... */}
      <Form className="mb-4">
        <InputGroup>
          <Form.Control
            type="text"
            placeholder="Search by Item, Name, Location, Status, or User"
            value={searchTerm}
            onChange={handleSearch}
          />
          <Button variant="outline-secondary" onClick={resetFilters}>
            Reset
          </Button>
        </InputGroup>
      </Form>
      <div className="mb-3">
        <small className="text-muted">
          Showing {totalCount > 0 ? indexOfFirstItem + 1 : 0} to {indexOfLastItem} of {totalCount} entries
        </small>
      </div>

      {/* Table (อัปเกรด Table) */}
      <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
        <Table striped bordered hover style={{ minWidth: '1500px' }}>
          {/* ... (<thead> ... ถูกต้อง) ... */}
          <thead>
            <tr>
              {[
                { label: 'Actions', key: null }, 
                { label: 'Status', key: 'STATUS' },
                { label: 'Scheduled Time', key: 'SCHEDULED_DATETIME' },
                { label: 'Item No', key: 'ITEM_NO' },
                { label: 'Item Name', key: 'ITEM_NAME' },
                { label: 'Location', key: 'LOCATION_NAME' },
                { label: 'Sch. Qty', key: 'SCHEDULED_QTY' },
                { label: 'Act. Qty', key: 'ACTUAL_QTY' },
                { label: 'Confirmed Time', key: 'CONFIRM_DATETIME' },
                { label: 'User', key: 'RECEIVED_BY_NAME' },
              ].map(({ label, key }) => (
                <th 
                  key={key || label}
                  onClick={() => key && handleSort(key)}
                  style={{ cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
                >
                  {label}
                  {key && sortConfig.key === key &&
                    (sortConfig.direction === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="10" className="text-center py-4"><Spinner /></td></tr>
            ) : schedules.length === 0 ? (
              <tr><td colSpan="10" className="text-center py-4">No schedule history found.</td></tr>
            ) : (
              schedules.map((item) => (
                <tr key={item.SCHEDULE_ID}>
                  
                  {/* --- [FIX 2] อัปเกรด Cell สำหรับปุ่ม Actions --- */}
                  <td className="text-center">
                    {item.STATUS === 'PENDING' ? (
                      <>
                        {/* 1. ปุ่ม Receive */}
                        <Button 
                          variant="info" 
                          size="sm"
                          className="me-2" // เว้นวรรค
                          onClick={() => handleShowReceiveModal(item)}
                          disabled={loadingCancel === item.SCHEDULE_ID} // Disable ตอนกำลัง Cancel
                        >
                          <Inbox size={14} className="me-1" /> Receive
                        </Button>
                        
                        {/* 2. ปุ่ม Cancel (ที่ขาดไป) */}
                        <Button 
                          variant="danger" 
                          size="sm"
                          onClick={() => handleCancel(item.SCHEDULE_ID)}
                          disabled={loadingCancel === item.SCHEDULE_ID} // Disable
                        >
                          {loadingCancel === item.SCHEDULE_ID 
                            ? <Spinner as="span" animation="border" size="sm" />
                            : <Trash2 size={14} />
                          }
                        </Button>
                      </>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  {/* ------------------------------------------- */}
                  
                  <td style={{ whiteSpace: 'nowrap' }}>{renderStatusBadge(item.STATUS)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.SCHEDULED_DATETIME)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.ITEM_NO}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.ITEM_NAME || 'N/A'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.LOCATION_NAME}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatQty(item.SCHEDULED_QTY)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatQty(item.ACTUAL_QTY)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.CONFIRM_DATETIME)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.RECEIVED_BY_NAME || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>

      {/* ... (Pagination ... ถูกต้อง) ... */}
       {totalPages > 1 && !loading && (
        <div className="d-flex justify-content-center">
          <Pagination>
            <Pagination.First onClick={() => handlePageChange(1)} disabled={currentPage === 1} />
            <Pagination.Prev onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} />
            {generatePaginationItems()}
            <Pagination.Next onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} />
            <Pagination.Last onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} />
          </Pagination>
        </div>
      )}

      {/* ... (Modal ... ถูกต้อง) ... */}
      <PendingReceiveModal
        show={showReceiveModal}
        item={selectedItem}
        onHide={handleHideReceiveModal}
        onConfirmSuccess={handleConfirmSuccess}
      />

    </Container>
  );
};

export default ScheduleHistory;