import React, { useState, useEffect, useCallback } from 'react';
import { Container, Table, Alert, Spinner, Form, InputGroup, Button, Pagination } from 'react-bootstrap';
import { AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { apiCall } from '../../App';

// Custom Hook สำหรับ Debounce
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

const ItemMaster = () => {
  const [items, setItems] = useState([]); // State สำหรับเก็บข้อมูลที่แสดงผล
  const [totalCount, setTotalCount] = useState(0); // State สำหรับเก็บจำนวนข้อมูลทั้งหมด
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // State สำหรับการควบคุม
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'ITEM_NO', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  // ใช้ Debounce กับ searchTerm
  const debouncedSearchTerm = useDebounce(searchTerm, 500); // 500ms delay

  // ฟังก์ชันกลางสำหรับดึงข้อมูล
  const fetchStorageData = useCallback(async () => {
    setLoading(true);
    try {
      // สร้าง URLSearchParams เพื่อส่งไปยัง API
      const params = new URLSearchParams({
        page: currentPage,
        limit: itemsPerPage,
        search: debouncedSearchTerm,
        sortKey: sortConfig.key,
        sortDir: sortConfig.direction,
      });

      const response = await apiCall(`/item-master?${params.toString()}`);
      
      setItems(response.data);
      setTotalCount(response.totalCount || 0);
      setError('');
    } catch (err) {
      setError('Failed to fetch item master data');
      setItems([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedSearchTerm, sortConfig, itemsPerPage]); // Dependency array

  // useEffect หลัก: จะทำงานเมื่อค่าใน dependency array เปลี่ยน
  useEffect(() => {
    fetchStorageData();
  }, [fetchStorageData]); // ยิง API เมื่อค่าเหล่านี้เปลี่ยน

  // Handle search: แค่ set state, useEffect จะทำงานเอง
  const handleSearch = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    setCurrentPage(1); // Reset to first page after search
  };

  // Handle sort: แค่ set state, useEffect จะทำงานเอง
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1); // Reset to first page
  };
  
  // Handle page change: แค่ set state, useEffect จะทำงานเอง
  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  // Reset filters
  const resetFilters = () => {
    setSearchTerm('');
    setSortConfig({ key: 'ITEM_NO', direction: 'asc' });
    setCurrentPage(1);
  };

  // คำนวณ Pagination
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const indexOfFirstItem = (currentPage - 1) * itemsPerPage;
  const indexOfLastItem = Math.min(indexOfFirstItem + itemsPerPage, totalCount);

  const generatePaginationItems = () => {
     const items = [];
     const maxVisiblePages = 5;

     if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        items.push(
        <Pagination.Item
        key={i}
        active={i === currentPage}
        onClick={() => handlePageChange(i)}
        >
          {i}
          </Pagination.Item>
          );
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


  return (
    <Container className="py-6" style={{ maxWidth: '95%' }}>
      <h2 className="text-2xl font-bold mb-4">Item Master</h2>

      {error && (
        <Alert variant="danger" className="mb-4 d-flex align-items-center">
          <AlertCircle className="h-4 w-4 mr-2" />
          {error}
        </Alert>
      )}

      <Form className="mb-4">
        <InputGroup>
          <Form.Control
            type="text"
            placeholder="Search by Item No, Item Name, Vendor, etc."
            value={searchTerm}
            onChange={handleSearch}
          />
          <Button variant="outline-secondary" onClick={resetFilters}>
            Reset
          </Button>
        </InputGroup>
      </Form>

      {/* แสดงข้อมูลสถิติ */}
      <div className="mb-3">
        <small className="text-muted">
          Showing {totalCount > 0 ? indexOfFirstItem + 1 : 0} to {indexOfLastItem} of {totalCount} entries
        </small>
      </div>

      {/* Table with horizontal scroll */}
      <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
        <Table striped bordered hover style={{ minWidth: '1200px' }}>
          <thead>
            <tr>
              {[
                { label: 'ITEM_NO', key: 'ITEM_NO' },
                { label: 'ITEM_NAME', key: 'ITEM_NAME' },
                { label: 'SPEC', key: 'SPEC' },
                { label: 'DRWG', key: 'DRWG' },
                { label: 'ACCOUNT', key: 'ACCOUNT' },
                { label: 'VENDOR_CODE', key: 'VENDOR_CODE' },
                { label: 'VENDOR_NAME', key: 'VENDOR_NAME' },
                { label: 'PUR_LEAD_TIME', key: 'PUR_LEAD_TIME' },
                { label: 'MAKER_NAME', key: 'MAKER_NAME' },
                { label: 'REMARK', key: 'REMARK' },
                { label: 'DIVISION', key: 'DIVISION_SCRIPT' },
              ].map(({ label, key }) => (
                <th key={key} onClick={() => handleSort(key)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {label}
                  {sortConfig.key === key &&
                    (sortConfig.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 d-inline ml-1" />
                    ) : (
                      <ArrowDown className="h-4 w-4 d-inline ml-1" />
                    ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="11" className="text-center py-4">
                   <Spinner animation="border" variant="primary" />
                   <p className="mt-2">Loading data...</p>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan="11" className="text-center py-4">
                  No item master data available for your criteria
                </td>
              </tr>
            ) : (
              // แก้ไข: ลบ comma (,) ที่ผิดพลาดออกจากท้าย <td>
              items.map((item, index) => (
                <tr key={index}>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.ITEM_NO}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.ITEM_NAME}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.SPEC}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.DRWG}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.ACCOUNT}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.VENDOR_CODE}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.VENDOR_NAME}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.PUR_LEAD_TIME}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.MAKER_NAME}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.REMARK}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.DIVISION_SCRIPT}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && !loading && (
        <div className="d-flex justify-content-center">
          <Pagination>
            <Pagination.First 
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
            />
            <Pagination.Prev 
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            />
            {generatePaginationItems()}
            <Pagination.Next 
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            />
            <Pagination.Last 
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
            />
          </Pagination>
        </div>
      )}
    </Container>
  );
};

export default ItemMaster;