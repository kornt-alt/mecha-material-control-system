import React from 'react';
import { Container, Card } from 'react-bootstrap';

const About = () => {
  return (
    <Container className="py-4">
      <h1 className="text-center mb-4">MATERIAL CONTROL SYSTEM</h1>
      <Card>
        <Card.Body>
          <Card.Title>ยินดีต้อนรับเข้าสู่ระบบการ MATERIAL ของ MECHA!</Card.Title>
          <Card.Text>
            From Production Engineer
          </Card.Text>
          <Card.Text>
            Create By Korn PE<br></br>
            NOV 2025
          </Card.Text>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default About;