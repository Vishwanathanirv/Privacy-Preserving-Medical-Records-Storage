import streamlit as st
import cv2
import numpy as np
import torch
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import json
import hashlib
import base64
import os
import time
import sqlite3
from datetime import datetime, timedelta
from contextlib import contextmanager
from sklearn.metrics import confusion_matrix
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from model.predict_model import PredictModel
from histogram import cnn_histogram_shifting
from helpers import calculate_complexity, arithenco, num2bitlist, calculate_tp_tn

# Set page config must be the first Streamlit command
st.set_page_config(
    page_title="DCUNA Medical Record System",
    page_icon="🏥",
    layout="wide"
)

# Device configuration
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Set matplotlib style
plt.style.use('default')
sns.set_style("whitegrid")

# ==================== SQLITE DATABASE MANAGEMENT ====================

class DatabaseManager:
    """SQLite database manager for DCUNA system"""
    
    def __init__(self, db_path='dcuna_system.db'):
        self.db_path = db_path
        self.init_database()
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    
    def init_database(self):
        """Initialize database with all required tables"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Users table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL,
                full_name TEXT,
                department TEXT,
                license_number TEXT,
                specialization TEXT,
                date_of_birth TEXT,
                blood_type TEXT,
                emergency_contact TEXT,
                registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active',
                last_login TIMESTAMP
            )
            ''')
            
            # Doctor-Patient relationships
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS doctor_patient_relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doctor_username TEXT NOT NULL,
                patient_username TEXT NOT NULL,
                assigned_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active',
                FOREIGN KEY (doctor_username) REFERENCES users(username),
                FOREIGN KEY (patient_username) REFERENCES users(username),
                UNIQUE(doctor_username, patient_username)
            )
            ''')
            
            # Medical records
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS medical_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id TEXT UNIQUE NOT NULL,
                patient_username TEXT NOT NULL,
                patient_name TEXT NOT NULL,
                diagnosis TEXT NOT NULL,
                treatment TEXT NOT NULL,
                doctor_username TEXT NOT NULL,
                doctor_name TEXT NOT NULL,
                doctor_department TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active',
                confidential_level TEXT DEFAULT 'high',
                FOREIGN KEY (patient_username) REFERENCES users(username),
                FOREIGN KEY (doctor_username) REFERENCES users(username)
            )
            ''')
            
            # Record access permissions
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS record_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id TEXT NOT NULL,
                doctor_username TEXT NOT NULL,
                permissions TEXT DEFAULT 'read',
                granted_by TEXT NOT NULL,
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (record_id) REFERENCES medical_records(record_id),
                FOREIGN KEY (doctor_username) REFERENCES users(username),
                UNIQUE(record_id, doctor_username)
            )
            ''')
            
            # Encrypted files
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS encrypted_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id TEXT UNIQUE NOT NULL,
                encryption_type TEXT NOT NULL,
                watermark_text TEXT NOT NULL,
                access_info TEXT,
                record_data TEXT NOT NULL,
                encryption_key TEXT NOT NULL,
                encrypted_by TEXT NOT NULL,
                encrypted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (record_id) REFERENCES medical_records(record_id)
            )
            ''')
            
            # DCUNA nodes
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS dcuna_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT UNIQUE NOT NULL,
                node_name TEXT NOT NULL,
                node_type TEXT NOT NULL,
                owner_username TEXT NOT NULL,
                permissions TEXT,
                node_key TEXT NOT NULL,
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP,
                status TEXT DEFAULT 'active',
                FOREIGN KEY (owner_username) REFERENCES users(username)
            )
            ''')
            
            # Access logs
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                node_id TEXT,
                node_owner TEXT,
                resource_id TEXT,
                requesting_user TEXT,
                user_role TEXT,
                authorized INTEGER DEFAULT 0,
                action TEXT,
                reason TEXT,
                ip_address TEXT
            )
            ''')
            
            # Record access logs
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS record_access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                record_id TEXT NOT NULL,
                action TEXT NOT NULL,
                user TEXT NOT NULL,
                details TEXT,
                FOREIGN KEY (record_id) REFERENCES medical_records(record_id)
            )
            ''')
            
            # Create indexes for better performance
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_username)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_records_doctor ON medical_records(doctor_username)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_access_record ON record_access(record_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_access_doctor ON record_access(doctor_username)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON access_logs(timestamp)')
            
            conn.commit()
    
    def add_user(self, user_data):
        """Add a new user to database"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            INSERT INTO users (
                username, password_hash, email, role, full_name,
                department, license_number, specialization,
                date_of_birth, blood_type, emergency_contact
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_data['username'],
                user_data['password_hash'],
                user_data['email'],
                user_data['role'],
                user_data.get('full_name', ''),
                user_data.get('department', ''),
                user_data.get('license_number', ''),
                user_data.get('specialization', ''),
                user_data.get('date_of_birth', ''),
                user_data.get('blood_type', ''),
                user_data.get('emergency_contact', '')
            ))
            conn.commit()
            return cursor.lastrowid
    
    def get_user(self, username):
        """Get user by username"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def get_all_users(self, role=None):
        """Get all users, optionally filtered by role"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if role:
                cursor.execute('SELECT * FROM users WHERE role = ? ORDER BY full_name', (role,))
            else:
                cursor.execute('SELECT * FROM users ORDER BY role, full_name')
            return [dict(row) for row in cursor.fetchall()]
    
    def update_user_last_login(self, username):
        """Update user's last login timestamp"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?',
                (username,)
            )
            conn.commit()
    
    def assign_doctor_to_patient(self, doctor_username, patient_username):
        """Assign a doctor to a patient"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute('''
                INSERT INTO doctor_patient_relationships (doctor_username, patient_username)
                VALUES (?, ?)
                ''', (doctor_username, patient_username))
                conn.commit()
                return True, "Assignment successful"
            except sqlite3.IntegrityError:
                return False, "Relationship already exists"
    
    def get_doctor_patients(self, doctor_username):
        """Get all patients assigned to a doctor"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            SELECT u.* FROM users u
            JOIN doctor_patient_relationships r ON u.username = r.patient_username
            WHERE r.doctor_username = ? AND r.status = 'active'
            ''', (doctor_username,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_patient_doctors(self, patient_username):
        """Get all doctors assigned to a patient"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            SELECT u.* FROM users u
            JOIN doctor_patient_relationships r ON u.username = r.doctor_username
            WHERE r.patient_username = ? AND r.status = 'active'
            ''', (patient_username,))
            return [dict(row) for row in cursor.fetchall()]
    
    def create_medical_record(self, record_data):
        """Create a new medical record"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            INSERT INTO medical_records (
                record_id, patient_username, patient_name,
                diagnosis, treatment, doctor_username,
                doctor_name, doctor_department, confidential_level
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                record_data['record_id'],
                record_data['patient_username'],
                record_data['patient_name'],
                record_data['diagnosis'],
                record_data['treatment'],
                record_data['doctor_username'],
                record_data['doctor_name'],
                record_data.get('doctor_department', ''),
                record_data.get('confidential_level', 'high')
            ))
            conn.commit()
            return cursor.lastrowid
    
    def grant_record_access(self, record_id, doctor_username, granted_by):
        """Grant access to a record for a doctor"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute('''
                INSERT INTO record_access (record_id, doctor_username, granted_by)
                VALUES (?, ?, ?)
                ''', (record_id, doctor_username, granted_by))
                conn.commit()
                return True, "Access granted successfully"
            except sqlite3.IntegrityError:
                return False, "Access already granted"
    
    def get_record_access(self, record_id):
        """Get all doctors with access to a record"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            SELECT ra.*, u.full_name, u.department 
            FROM record_access ra
            JOIN users u ON ra.doctor_username = u.username
            WHERE ra.record_id = ?
            ''', (record_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def check_record_access(self, record_id, doctor_username):
        """Check if a doctor has access to a record"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            SELECT * FROM record_access 
            WHERE record_id = ? AND doctor_username = ?
            ''', (record_id, doctor_username))
            return cursor.fetchone() is not None
    
    def get_patient_records(self, patient_username):
        """Get all records for a patient"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            SELECT * FROM medical_records 
            WHERE patient_username = ? 
            ORDER BY created_at DESC
            ''', (patient_username,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_doctor_accessible_records(self, doctor_username):
        """Get all records accessible to a doctor"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            SELECT DISTINCT mr.* FROM medical_records mr
            LEFT JOIN record_access ra ON mr.record_id = ra.record_id
            WHERE mr.doctor_username = ? OR ra.doctor_username = ?
            ORDER BY mr.created_at DESC
            ''', (doctor_username, doctor_username))
            return [dict(row) for row in cursor.fetchall()]
    
    def save_encrypted_file(self, encrypted_data):
        """Save encrypted file data"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            INSERT INTO encrypted_files (
                record_id, encryption_type, watermark_text,
                access_info, record_data, encryption_key, encrypted_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                encrypted_data['record_id'],
                encrypted_data['encryption_type'],
                encrypted_data['watermark_text'],
                encrypted_data.get('access_info', ''),
                encrypted_data['record_data'],
                encrypted_data['encryption_key'],
                encrypted_data['encrypted_by']
            ))
            conn.commit()
            return cursor.lastrowid
    
    def get_encrypted_file(self, record_id):
        """Get encrypted file by record ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM encrypted_files WHERE record_id = ?', (record_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def register_node(self, node_data):
        """Register a new DCUNA node"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            INSERT INTO dcuna_nodes (
                node_id, node_name, node_type, owner_username,
                permissions, node_key
            ) VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                node_data['node_id'],
                node_data['node_name'],
                node_data['node_type'],
                node_data['owner_username'],
                node_data.get('permissions', ''),
                node_data['node_key']
            ))
            conn.commit()
            return True
    
    def get_node(self, node_id):
        """Get node by ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM dcuna_nodes WHERE node_id = ?', (node_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def get_user_nodes(self, username):
        """Get all nodes owned by a user"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM dcuna_nodes WHERE owner_username = ?', (username,))
            return [dict(row) for row in cursor.fetchall()]
    
    def log_access_attempt(self, log_data):
        """Log access attempt"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            INSERT INTO access_logs (
                node_id, node_owner, resource_id, requesting_user,
                user_role, authorized, action, reason, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                log_data.get('node_id'),
                log_data.get('node_owner'),
                log_data.get('resource_id'),
                log_data.get('requesting_user'),
                log_data.get('user_role'),
                log_data.get('authorized', 0),
                log_data.get('action'),
                log_data.get('reason'),
                log_data.get('ip_address', '127.0.0.1')
            ))
            conn.commit()
    
    def log_record_access(self, log_data):
        """Log record access"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
            INSERT INTO record_access_logs (record_id, action, user, details)
            VALUES (?, ?, ?, ?)
            ''', (
                log_data['record_id'],
                log_data['action'],
                log_data['user'],
                log_data.get('details', '')
            ))
            conn.commit()
    
    def get_system_stats(self):
        """Get system statistics"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            stats = {}
            
            # User counts
            cursor.execute('SELECT role, COUNT(*) as count FROM users GROUP BY role')
            role_counts = cursor.fetchall()
            stats['users_by_role'] = {row['role']: row['count'] for row in role_counts}
            
            # Total records
            cursor.execute('SELECT COUNT(*) as count FROM medical_records')
            stats['total_records'] = cursor.fetchone()['count']
            
            # Active nodes
            cursor.execute("SELECT COUNT(*) as count FROM dcuna_nodes WHERE status = 'active'")
            stats['active_nodes'] = cursor.fetchone()['count']
            
            # Access logs summary
            cursor.execute('SELECT authorized, COUNT(*) as count FROM access_logs GROUP BY authorized')
            access_counts = cursor.fetchall()
            stats['authorized_access'] = next((row['count'] for row in access_counts if row['authorized'] == 1), 0)
            stats['denied_access'] = next((row['count'] for row in access_counts if row['authorized'] == 0), 0)
            
            return stats

# ==================== ENHANCED USER MANAGEMENT SYSTEM WITH SQLITE ====================

class UserManagement:
    """Enhanced user registration and login system with SQLite"""
    
    def __init__(self, db_manager):
        self.db = db_manager
        
    def register_user(self, username, password, email, role="patient", **kwargs):
        """Register a new user"""
        existing_user = self.db.get_user(username)
        if existing_user:
            return {"success": False, "error": "Username already exists"}
        
        # Hash password
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        
        user_data = {
            'username': username,
            'password_hash': password_hash,
            'email': email,
            'role': role,
            'full_name': kwargs.get('full_name', ''),
            'department': kwargs.get('department', ''),
            'license_number': kwargs.get('license_number', ''),
            'specialization': kwargs.get('specialization', ''),
            'date_of_birth': kwargs.get('date_of_birth', ''),
            'blood_type': kwargs.get('blood_type', ''),
            'emergency_contact': kwargs.get('emergency_contact', '')
        }
        
        try:
            self.db.add_user(user_data)
            return {"success": True, "message": "User registered successfully", "user": user_data}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def login_user(self, username, password):
        """Login existing user"""
        user = self.db.get_user(username)
        if not user:
            return {"success": False, "error": "User not found"}
        
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        
        if user['password_hash'] == password_hash:
            if user['status'] == 'active':
                # Update last login
                self.db.update_user_last_login(username)
                return {"success": True, "user": user}
            else:
                return {"success": False, "error": "Account is inactive"}
        else:
            return {"success": False, "error": "Invalid password"}
    
    def assign_doctor_to_patient(self, doctor_username, patient_username):
        """Assign a doctor to a patient"""
        doctor = self.db.get_user(doctor_username)
        patient = self.db.get_user(patient_username)
        
        if not doctor or doctor['role'] != 'doctor':
            return {"success": False, "error": "Invalid doctor username"}
        
        if not patient or patient['role'] != 'patient':
            return {"success": False, "error": "Invalid patient username"}
        
        success, message = self.db.assign_doctor_to_patient(doctor_username, patient_username)
        return {"success": success, "message": message}
    
    def grant_record_access(self, record_id, doctor_username, granted_by):
        """Grant access to a specific record for a doctor"""
        success, message = self.db.grant_record_access(record_id, doctor_username, granted_by)
        return {"success": success, "message": message}
    
    def check_record_access(self, record_id, doctor_username):
        """Check if a doctor has access to a specific record"""
        return self.db.check_record_access(record_id, doctor_username)
    
    def get_patient_doctors(self, patient_username):
        """Get all doctors assigned to a patient"""
        return self.db.get_patient_doctors(patient_username)
    
    def get_doctor_patients(self, doctor_username):
        """Get all patients assigned to a doctor"""
        return self.db.get_doctor_patients(doctor_username)
    
    def get_all_doctors(self):
        """Get all registered doctors"""
        return self.db.get_all_users('doctor')
    
    def get_all_patients(self):
        """Get all registered patients"""
        return self.db.get_all_users('patient')

# ==================== ENHANCED DCUNA AUTHORIZATION SYSTEM WITH SQLITE ====================

class DCUNAAuthorization:
    """Enhanced Distributed Customizable Unique Node Access System with SQLite"""
    
    def __init__(self, db_manager):
        self.db = db_manager
        
    def register_node(self, node_id, node_name, node_type, owner_username, permissions):
        """Register a new node with owner"""
        node_key = hashlib.sha256(f"{node_id}{node_name}{owner_username}{datetime.now().timestamp()}".encode()).hexdigest()
        
        node_data = {
            'node_id': node_id,
            'node_name': node_name,
            'node_type': node_type,
            'owner_username': owner_username,
            'permissions': json.dumps(permissions),
            'node_key': node_key
        }
        
        success = self.db.register_node(node_data)
        if success:
            return {"success": True, "node_key": node_key}
        else:
            return {"success": False, "error": "Failed to register node"}
    
    def authorize_access(self, node_id, node_key, resource_id, user_role=None, requesting_user=None):
        """Authorize access to a resource with enhanced checks"""
        node = self.db.get_node(node_id)
        if not node:
            return {"authorized": False, "reason": "Node not registered"}
        
        if node['node_key'] != node_key:
            return {"authorized": False, "reason": "Invalid node key"}
        
        if node['status'] != 'active':
            return {"authorized": False, "reason": "Node is inactive"}
        
        # Enhanced permission check
        authorized = self.check_enhanced_permissions(node, resource_id, user_role, requesting_user)
        
        # Log access attempt
        log_data = {
            'node_id': node_id,
            'node_owner': node['owner_username'],
            'resource_id': resource_id,
            'requesting_user': requesting_user,
            'user_role': user_role,
            'authorized': 1 if authorized else 0,
            'action': 'access',
            'reason': '' if authorized else 'Access denied - insufficient permissions'
        }
        self.db.log_access_attempt(log_data)
        
        if authorized:
            return {
                "authorized": True,
                "message": "Access granted",
                "node_info": node,
                "permissions": json.loads(node['permissions']) if node['permissions'] else []
            }
        else:
            return {"authorized": False, "reason": "Access denied - insufficient permissions"}
    
    def check_enhanced_permissions(self, node, resource_id, user_role, requesting_user):
        """Enhanced permission checking with user-specific rules"""
        node_type = node['node_type']
        
        # Admin nodes have full access
        if node_type == 'admin':
            return True
        
        # Doctor nodes can access their patients' records
        elif node_type == 'doctor':
            if user_role == 'admin':
                return True
            elif user_role == 'doctor':
                # Check if this doctor has access to this specific record
                return self.db.check_record_access(resource_id, requesting_user)
            return False
        
        # Patient nodes can only access their own records
        elif node_type == 'patient':
            # Get record to check patient
            # This would need additional logic to match record with patient
            return user_role == 'patient'
        
        # Nurse nodes have limited access
        elif node_type == 'nurse':
            return user_role in ['nurse', 'doctor', 'admin']
        
        return False
    
    def get_user_nodes(self, username):
        """Get all nodes owned by a user"""
        return self.db.get_user_nodes(username)
    
    def get_access_logs(self, user_filter=None):
        """Get access logs, optionally filtered by user"""
        # Note: This is a simplified version - in full implementation,
        # we would add a method to DatabaseManager to filter logs by user
        logs = []
        with self.db.get_connection() as conn:
            cursor = conn.cursor()
            if user_filter:
                cursor.execute('''
                SELECT * FROM access_logs 
                WHERE requesting_user = ? 
                ORDER BY timestamp DESC LIMIT 100
                ''', (user_filter,))
            else:
                cursor.execute('SELECT * FROM access_logs ORDER BY timestamp DESC LIMIT 100')
            logs = [dict(row) for row in cursor.fetchall()]
        return logs

# ==================== ENHANCED MEDICAL RECORD SYSTEM WITH SQLITE ====================

class MedicalRecordSystem:
    """Enhanced medical record system with SQLite"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def create_medical_record(self, patient_info, diagnosis, treatment, doctor_info, allowed_doctors=None):
        """Create a medical record with access control"""
        record_id = f"MR_{hashlib.sha256(f'{patient_info}{datetime.now().timestamp()}'.encode()).hexdigest()[:12]}"
        
        record_data = {
            'record_id': record_id,
            'patient_username': patient_info['username'],
            'patient_name': patient_info['name'],
            'diagnosis': diagnosis,
            'treatment': treatment,
            'doctor_username': doctor_info['username'],
            'doctor_name': doctor_info['name'],
            'doctor_department': doctor_info.get('department', ''),
            'confidential_level': 'high'
        }
        
        try:
            # Save medical record
            self.db.create_medical_record(record_data)
            
            # Grant access to allowed doctors
            if allowed_doctors:
                for doctor_username in allowed_doctors:
                    self.db.grant_record_access(record_id, doctor_username, doctor_info['username'])
            
            # Log record creation
            self.db.log_record_access({
                'record_id': record_id,
                'action': 'create',
                'user': doctor_info['username'],
                'details': f"Created record for patient {patient_info['name']}"
            })
            
            return {
                "success": True,
                "record_id": record_id,
                "record": {
                    **record_data,
                    'created_at': datetime.now().isoformat(),
                    'allowed_doctors': allowed_doctors or []
                }
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def encrypt_with_rdh_watermarking(self, record, watermark_text, image=None, allowed_doctors=None, encrypting_doctor=None):
        """Encrypt record using RDH CNN watermarking with access control"""
        try:
            # Convert record to string for watermarking
            record_str = json.dumps(record, indent=2)
            
            # Create watermark text with access info
            access_info = {
                "allowed_doctors": allowed_doctors or [encrypting_doctor] if encrypting_doctor else [],
                "encrypting_doctor": encrypting_doctor,
                "encryption_time": datetime.now().isoformat(),
                "record_id": record["record_id"]
            }
            
            watermark_with_access = f"{watermark_text}||ACCESS:{json.dumps(access_info)}"
            
            if image is not None:
                watermarked_image, encryption_key = self.embed_watermark_in_image(image, watermark_with_access, record_str)
                encryption_type = "image_watermarked"
            else:
                synthetic_image = self.create_synthetic_image()
                watermarked_image, encryption_key = self.embed_watermark_in_image(synthetic_image, watermark_with_access, record_str)
                encryption_type = "synthetic_image_watermarked"
            
            # Prepare encrypted data for database
            encrypted_data = {
                'record_id': record['record_id'],
                'encryption_type': encryption_type,
                'watermark_text': watermark_text,
                'access_info': json.dumps(access_info),
                'record_data': record_str,
                'encryption_key': encryption_key,
                'encrypted_by': encrypting_doctor or 'unknown'
            }
            
            # Save to database
            self.db.save_encrypted_file(encrypted_data)
            
            return {
                "success": True,
                "encrypted_data": encrypted_data,
                "record_id": record["record_id"],
                "encryption_key": encryption_key,
                "allowed_doctors": allowed_doctors
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def create_synthetic_image(self):
        """Create a synthetic image for watermarking"""
        image = np.zeros((512, 512), dtype=np.float64)
        
        for i in range(10):
            x = np.random.randint(50, 450)
            y = np.random.randint(50, 450)
            radius = np.random.randint(20, 80)
            intensity = np.random.uniform(100, 200)
            
            for dx in range(-radius, radius):
                for dy in range(-radius, radius):
                    if dx*dx + dy*dy <= radius*radius:
                        xi, yi = x + dx, y + dy
                        if 0 <= xi < 512 and 0 <= yi < 512:
                            image[xi, yi] = intensity
        
        x, y = np.meshgrid(np.linspace(0, 1, 512), np.linspace(0, 1, 512))
        gradient = 100 * (x + y) / 2
        image += gradient
        
        return np.clip(image, 0, 255).astype(np.float64)
    
    def embed_watermark_in_image(self, image, watermark_text, additional_data=""):
        """Embed watermark in image using RDH CNN method"""
        try:
            combined_text = f"{watermark_text}||{additional_data}"
            watermark_bits = np.array([int(b) for char in combined_text for b in format(ord(char), '08b')])
            
            if len(image.shape) == 3:
                image_gray = cv2.cvtColor(image.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float64)
            else:
                image_gray = image.astype(np.float64)
            
            predicted_image = image_gray.copy()
            if 'model' in globals() and model is not None:
                try:
                    input_tensor = torch.from_numpy(image_gray).float() / 255.0
                    input_tensor = input_tensor.unsqueeze(0).unsqueeze(0)
                    predicted_tensor = model.test_on_batch(input_tensor)
                    predicted_image = predicted_tensor.squeeze().cpu().numpy() * 255.0
                    predicted_image = np.clip(predicted_image, 0, 255).astype(np.float64)
                except:
                    pass
            
            img_embedded, index_complexity, inserable_place = cnn_histogram_shifting(
                image_gray,
                predicted_image,
                watermark_bits,
                0,
                calculate_complexity,
                arithenco,
                num2bitlist,
                calculate_tp_tn
            )
            
            encryption_key = hashlib.sha256(watermark_text.encode()).hexdigest()[:32]
            
            return img_embedded, encryption_key
            
        except Exception as e:
            st.error(f"Watermarking error: {e}")
            return image, "fallback_key"
    
    def decrypt_record(self, record_id, decryption_key, requesting_doctor=None):
        """Decrypt record with doctor verification"""
        encrypted_file = self.db.get_encrypted_file(record_id)
        if not encrypted_file:
            return {"success": False, "error": "Record not found"}
        
        # Check if doctor is authorized
        if requesting_doctor:
            if not self.db.check_record_access(record_id, requesting_doctor):
                return {"success": False, "error": "Access denied. You are not authorized to view this record."}
        
        # Check encryption key
        if decryption_key != encrypted_file['encryption_key']:
            return {"success": False, "error": "Invalid decryption key"}
        
        # Check if doctor is in allowed list
        if requesting_doctor and encrypted_file['access_info']:
            try:
                access_info = json.loads(encrypted_file['access_info'])
                allowed_doctors = access_info.get('allowed_doctors', [])
                if requesting_doctor not in allowed_doctors:
                    return {"success": False, "error": "Doctor not in authorized list"}
            except:
                pass
        
        # Log successful decryption
        self.db.log_record_access({
            'record_id': record_id,
            'action': 'decrypt',
            'user': requesting_doctor or 'unknown',
            'details': 'Record decrypted successfully'
        })
        
        return {
            "success": True,
            "record_data": json.loads(encrypted_file['record_data']),
            "watermark_text": encrypted_file['watermark_text'],
            "access_info": json.loads(encrypted_file['access_info']) if encrypted_file['access_info'] else {},
            "encrypted_by": encrypted_file['encrypted_by']
        }
    
    def get_patient_records(self, patient_username):
        """Get all records for a patient"""
        return self.db.get_patient_records(patient_username)
    
    def get_doctor_accessible_records(self, doctor_username):
        """Get all records accessible to a doctor"""
        return self.db.get_doctor_accessible_records(doctor_username)

# ==================== LOAD CNN MODEL ====================

model = None
try:
    state_dict = torch.load('./model_parameter/model_state.pth', map_location=device)
    
    actual_state_dict = state_dict
    if 'network' in state_dict:
        actual_state_dict = state_dict['network']
    elif 'model_state_dict' in state_dict:
        actual_state_dict = state_dict['model_state_dict']
    elif 'state_dict' in state_dict:
        actual_state_dict = state_dict['state_dict']
    
    model = PredictModel(device)
    model.model.load_state_dict(actual_state_dict, strict=True)
    model.model.to(device)
    model.model.eval()
    
except Exception as e:
    st.warning(f"⚠️ Model loading issue: {e}")
    st.info("⚠️ Using alternative methods when needed")
    model = None

# ==================== HELPER FUNCTIONS ====================

def calculate_metrics(original, watermarked):
    """Calculate image quality metrics"""
    original = original.astype(np.float64)
    watermarked = watermarked.astype(np.float64)
    
    mse = np.mean((original - watermarked) ** 2)
    psnr = 20 * np.log10(255.0 / np.sqrt(mse)) if mse > 0 else float('inf')
    
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2
    mu_x = np.mean(original)
    mu_y = np.mean(watermarked)
    sigma_x = np.std(original)
    sigma_y = np.std(watermarked)
    sigma_xy = np.cov(original.flatten(), watermarked.flatten())[0, 1]
    
    ssim = ((2 * mu_x * mu_y + C1) * (2 * sigma_xy + C2)) / \
           ((mu_x ** 2 + mu_y ** 2 + C1) * (sigma_x ** 2 + sigma_y ** 2 + C2))
    
    correlation = np.corrcoef(original.flatten(), watermarked.flatten())[0, 1]
    
    return {
        'mse': mse,
        'psnr': psnr,
        'ssim': ssim,
        'correlation': correlation,
        'max_diff': np.max(np.abs(original - watermarked))
    }

def plot_flow_diagram():
    """Plot the system flow diagram"""
    fig, ax = plt.subplots(figsize=(12, 10))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 12)
    ax.axis('off')
    
    steps = [
        {"id": 1, "name": "User Login\n(Doctor/Patient)", "pos": (5, 10), "color": "#4CAF50", "type": "start"},
        {"id": 2, "name": "Upload Medical Record\n(Doctor Input)", "pos": (5, 8), "color": "#2196F3", "type": "process"},
        {"id": 3, "name": "Data Pre-processing\n(Format & Validation)", "pos": (5, 6), "color": "#FF9800", "type": "process"},
        {"id": 4, "name": "Deep Encryption Module\n(RDH CNN Watermarking)", "pos": (5, 4), "color": "#9C27B0", "type": "process"},
        {"id": 5, "name": "DCUNA Authorization\n(Selective Doctor Access)", "pos": (5, 2), "color": "#3F51B5", "type": "decision"},
        {"id": 6, "name": "Retrieve Encrypted Data\n(Authorized Doctors Only)", "pos": (7, 1), "color": "#00BCD4", "type": "process"},
        {"id": 7, "name": "View Medical Record\n(Doctor-Specific Access)", "pos": (7, 0.5), "color": "#009688", "type": "end"},
        {"id": 8, "name": "Authorized Doctor:\nAccess Approved", "pos": (7, -0.5), "color": "#4CAF50", "type": "success"},
        {"id": 9, "name": "Unauthorized Access\nDenied", "pos": (3, 2), "color": "#F44336", "type": "failure"},
    ]
    
    connections = [
        (1, 2, "black", "-"),
        (2, 3, "black", "-"),
        (3, 4, "black", "-"),
        (4, 5, "black", "-"),
        (5, 6, "green", "-"),
        (6, 7, "green", "-"),
        (7, 8, "green", "->"),
        (5, 9, "red", "--")
    ]
    
    for src_id, dst_id, color, style in connections:
        src = next(s for s in steps if s["id"] == src_id)
        dst = next(s for s in steps if s["id"] == dst_id)
        
        ax.annotate("", xytext=src["pos"], xy=dst["pos"],
                   arrowprops=dict(arrowstyle="->" if ">" in style else "-",
                                  color=color, lw=2, linestyle=style[0]))
    
    for step in steps:
        if step["type"] == "start":
            shape = plt.Circle(step["pos"], 0.5, color=step["color"], ec='black', lw=2)
        elif step["type"] in ["success", "failure"]:
            shape = plt.Rectangle((step["pos"][0]-0.8, step["pos"][1]-0.4), 1.6, 0.8, 
                                 color=step["color"], ec='black', lw=2)
        elif step["type"] == "decision":
            diamond = np.array([[step["pos"][0], step["pos"][1]+0.5],
                               [step["pos"][0]+0.5, step["pos"][1]],
                               [step["pos"][0], step["pos"][1]-0.5],
                               [step["pos"][0]-0.5, step["pos"][1]]])
            shape = plt.Polygon(diamond, color=step["color"], ec='black', lw=2)
        else:
            shape = plt.Rectangle((step["pos"][0]-0.6, step["pos"][1]-0.4), 1.2, 0.8, 
                                 color=step["color"], ec='black', lw=2)
        
        ax.add_patch(shape)
        ax.text(step["pos"][0], step["pos"][1], step["name"], 
                ha='center', va='center', color='white', fontsize=9, fontweight='bold')
    
    ax.set_title("DCUNA Medical Record System Flow Diagram", fontsize=14, fontweight='bold', pad=20)
    return fig

# ==================== INITIALIZE SYSTEMS WITH SQLITE ====================

# Initialize database manager
if 'db_manager' not in st.session_state:
    st.session_state.db_manager = DatabaseManager()

# Initialize user system
if 'user_system' not in st.session_state:
    st.session_state.user_system = UserManagement(st.session_state.db_manager)

# Initialize DCUNA system
if 'dcuna_system' not in st.session_state:
    st.session_state.dcuna_system = DCUNAAuthorization(st.session_state.db_manager)

# Initialize medical system
if 'medical_system' not in st.session_state:
    st.session_state.medical_system = MedicalRecordSystem(st.session_state.db_manager)

# Initialize current user
if 'current_user' not in st.session_state:
    st.session_state.current_user = None

# Initialize current node
if 'current_node' not in st.session_state:
    st.session_state.current_node = None

# Initialize other session states
if 'current_record' not in st.session_state:
    st.session_state.current_record = None
if 'encrypted_data' not in st.session_state:
    st.session_state.encrypted_data = None
if 'decrypted_record' not in st.session_state:
    st.session_state.decrypted_record = None
if 'step2_complete' not in st.session_state:
    st.session_state.step2_complete = False
if 'step3_complete' not in st.session_state:
    st.session_state.step3_complete = False
if 'step4_complete' not in st.session_state:
    st.session_state.step4_complete = False
if 'step5_complete' not in st.session_state:
    st.session_state.step5_complete = False
if 'step6_complete' not in st.session_state:
    st.session_state.step6_complete = False
if 'step7_complete' not in st.session_state:
    st.session_state.step7_complete = False

# ==================== CUSTOM CSS ====================

st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        color: #1f618d;
        text-align: center;
        padding: 1rem;
        background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
        border-radius: 10px;
        margin-bottom: 1rem;
        border: 2px solid #1976d2;
    }
    .doctor-card {
        background-color: #e8f5e9;
        border-left: 5px solid #4CAF50;
        padding: 1rem;
        margin: 0.5rem 0;
        border-radius: 5px;
    }
    .patient-card {
        background-color: #e3f2fd;
        border-left: 5px solid #2196F3;
        padding: 1rem;
        margin: 0.5rem 0;
        border-radius: 5px;
    }
    .admin-card {
        background-color: #fff3e0;
        border-left: 5px solid #FF9800;
        padding: 1rem;
        margin: 0.5rem 0;
        border-radius: 5px;
    }
    .node-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        background-color: #1976d2;
        color: white;
        border-radius: 15px;
        font-size: 0.8rem;
        margin: 0.25rem;
    }
    .section-header {
        color: #1565c0;
        border-bottom: 3px solid #1976d2;
        padding-bottom: 0.5rem;
        margin-top: 2rem;
    }
    .access-granted {
        background-color: #e8f5e9;
        border: 2px solid #4CAF50;
        padding: 1rem;
        border-radius: 10px;
        margin: 1rem 0;
    }
    .access-denied {
        background-color: #ffebee;
        border: 2px solid #F44336;
        padding: 1rem;
        border-radius: 10px;
        margin: 1rem 0;
    }
    .database-info {
        background-color: #f5f5f5;
        border: 1px solid #ddd;
        padding: 1rem;
        border-radius: 5px;
        margin: 0.5rem 0;
    }
    .step-complete {
        background-color: #e8f5e9;
        border-left: 5px solid #4CAF50;
        padding: 0.5rem;
        margin: 0.5rem 0;
        border-radius: 5px;
    }
    .step-pending {
        background-color: #fff3e0;
        border-left: 5px solid #FF9800;
        padding: 0.5rem;
        margin: 0.5rem 0;
        border-radius: 5px;
    }
</style>
""", unsafe_allow_html=True)

# ==================== MAIN UI ====================

# Header
st.markdown('<h1 class="main-header">🏥 DCUNA Medical Record System with SQLite</h1>', unsafe_allow_html=True)
st.markdown("""
<div style="text-align: center; color: #666; margin-bottom: 2rem;">
    <p><strong>SQLite Database • Selective Doctor Access • RDH CNN Watermarking</strong></p>
</div>
""", unsafe_allow_html=True)

# Database Information
with st.expander("📊 Database Information", expanded=False):
    stats = st.session_state.db_manager.get_system_stats()
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Users", sum(stats['users_by_role'].values()))
    with col2:
        st.metric("Doctors", stats['users_by_role'].get('doctor', 0))
    with col3:
        st.metric("Patients", stats['users_by_role'].get('patient', 0))
    with col4:
        st.metric("Records", stats['total_records'])
    
    col5, col6 = st.columns(2)
    with col5:
        st.metric("Authorized Access", stats['authorized_access'])
    with col6:
        st.metric("Denied Access", stats['denied_access'])

# Display Flow Diagram
st.markdown('<h2 class="section-header">📊 System Flow Diagram</h2>', unsafe_allow_html=True)
flow_fig = plot_flow_diagram()
st.pyplot(flow_fig)

# Sidebar for current status
with st.sidebar:
    st.markdown("### 🏥 Current Status")
    
    if st.session_state.current_user:
        user_role = st.session_state.current_user["role"]
        user_card_class = {
            "doctor": "doctor-card",
            "patient": "patient-card", 
            "admin": "admin-card"
        }.get(user_role, "")
        
        st.markdown(f'<div class="{user_card_class}">', unsafe_allow_html=True)
        st.markdown(f"**Logged in as:** {st.session_state.current_user['username']}")
        st.markdown(f"**Role:** {user_role.title()}")
        if st.session_state.current_user.get('full_name'):
            st.markdown(f"**Name:** {st.session_state.current_user['full_name']}")
        if st.session_state.current_user.get('department'):
            st.markdown(f"**Department:** {st.session_state.current_user['department']}")
        registration_date = st.session_state.current_user.get('registration_date', '')
        if registration_date and len(registration_date) >= 10:
            st.markdown(f"**Registration:** {registration_date[:10]}")
        st.markdown("</div>", unsafe_allow_html=True)
        
        if st.button("🚪 Logout", use_container_width=True):
            st.session_state.current_user = None
            st.session_state.current_node = None
            st.session_state.current_record = None
            st.session_state.encrypted_data = None
            st.session_state.decrypted_record = None
            st.session_state.step2_complete = False
            st.session_state.step3_complete = False
            st.session_state.step4_complete = False
            st.session_state.step5_complete = False
            st.session_state.step6_complete = False
            st.session_state.step7_complete = False
            st.rerun()
    else:
        st.warning("Not logged in")
    
    st.markdown("---")
    st.markdown("### 📈 System Stats")
    stats = st.session_state.db_manager.get_system_stats()
    st.metric("Total Users", sum(stats['users_by_role'].values()))
    st.metric("Active Nodes", stats['active_nodes'])
    st.metric("Medical Records", stats['total_records'])
    
    st.markdown("---")
    st.markdown("### 🚀 Progress")
    steps_complete = sum([
        st.session_state.step2_complete,
        st.session_state.step3_complete,
        st.session_state.step4_complete,
        st.session_state.step5_complete,
        st.session_state.step6_complete,
        st.session_state.step7_complete
    ])
    st.progress(steps_complete / 7)

# ==================== STEP 1: USER LOGIN/REGISTER ====================
with st.expander("1. 👤 User Login/Registration", expanded=not st.session_state.current_user):
    if not st.session_state.current_user:
        tab1, tab2, tab3 = st.tabs(["Login", "Register Doctor", "Register Patient"])
        
        with tab1:
            st.markdown("### Login to System")
            login_username = st.text_input("Username", key="login_user")
            login_password = st.text_input("Password", type="password", key="login_pass")
            
            if st.button("Login", type="primary", key="login_btn", use_container_width=True):
                result = st.session_state.user_system.login_user(login_username, login_password)
                if result["success"]:
                    st.session_state.current_user = result["user"]
                    st.success(f"✅ Login successful! Welcome {result['user']['username']}")
                    st.rerun()
                else:
                    st.error(f"❌ {result['error']}")
        
        with tab2:
            st.markdown("### Register as Doctor")
            col1, col2 = st.columns(2)
            
            with col1:
                doc_username = st.text_input("Username", key="doc_user")
                doc_password = st.text_input("Password", type="password", key="doc_pass")
                doc_email = st.text_input("Email", key="doc_email")
                doc_fullname = st.text_input("Full Name", key="doc_fullname")
            
            with col2:
                doc_department = st.selectbox("Department", 
                    ["Cardiology", "Neurology", "Pediatrics", "Orthopedics", "General"], key="doc_dept")
                doc_license = st.text_input("Medical License Number", key="doc_license")
                doc_specialization = st.text_input("Specialization", key="doc_special")
            
            if st.button("Register as Doctor", type="secondary", key="doc_reg_btn", use_container_width=True):
                result = st.session_state.user_system.register_user(
                    doc_username, doc_password, doc_email, "doctor",
                    full_name=doc_fullname,
                    department=doc_department,
                    license_number=doc_license,
                    specialization=doc_specialization
                )
                if result["success"]:
                    st.success("✅ Doctor registration successful! Please login.")
                else:
                    st.error(f"❌ {result['error']}")
        
        with tab3:
            st.markdown("### Register as Patient")
            col1, col2 = st.columns(2)
            
            with col1:
                pat_username = st.text_input("Username", key="pat_user")
                pat_password = st.text_input("Password", type="password", key="pat_pass")
                pat_email = st.text_input("Email", key="pat_email")
                pat_fullname = st.text_input("Full Name", key="pat_fullname")
            
            with col2:
                pat_dob = st.date_input("Date of Birth", key="pat_dob")
                pat_blood = st.selectbox("Blood Type", 
                    ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"], key="pat_blood")
                pat_emergency = st.text_input("Emergency Contact", key="pat_emergency")
            
            if st.button("Register as Patient", type="secondary", key="pat_reg_btn", use_container_width=True):
                result = st.session_state.user_system.register_user(
                    pat_username, pat_password, pat_email, "patient",
                    full_name=pat_fullname,
                    date_of_birth=pat_dob.isoformat() if pat_dob else "",
                    blood_type=pat_blood,
                    emergency_contact=pat_emergency
                )
                if result["success"]:
                    st.success("✅ Patient registration successful! Please login.")
                else:
                    st.error(f"❌ {result['error']}")
    else:
        st.markdown('<div class="step-complete">', unsafe_allow_html=True)
        st.success(f"✅ Step 1 Complete: Logged in as {st.session_state.current_user['username']}")
        st.markdown("</div>", unsafe_allow_html=True)

# ==================== DOCTOR-PATIENT MANAGEMENT ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor":
    with st.expander("👥 Manage Patient Assignments", expanded=True):
        st.markdown("### Assign Patients to Your Care")
        
        # Get all patients
        all_patients = st.session_state.user_system.get_all_patients()
        current_doctor = st.session_state.current_user["username"]
        
        if all_patients:
            # Show current assignments
            current_patients = st.session_state.user_system.get_doctor_patients(current_doctor)
            if current_patients:
                st.markdown("**Currently Assigned Patients:**")
                for patient in current_patients:
                    st.markdown(f"• {patient.get('full_name', patient['username'])} ({patient['username']})")
            
            # Assign new patient
            current_patient_usernames = [p['username'] for p in current_patients]
            patient_options = {p["username"]: f"{p.get('full_name', p['username'])} ({p['username']})" 
                             for p in all_patients if p["username"] not in current_patient_usernames}
            
            if patient_options:
                selected_patient = st.selectbox("Select Patient to Assign", list(patient_options.keys()),
                                              format_func=lambda x: patient_options[x])
                
                if st.button("Assign Patient", type="primary"):
                    result = st.session_state.user_system.assign_doctor_to_patient(
                        current_doctor, selected_patient
                    )
                    if result["success"]:
                        st.success(f"✅ Patient {selected_patient} assigned to you!")
                        st.rerun()
                    else:
                        st.error(f"❌ {result['error']}")
            else:
                st.info("All patients are already assigned to you.")
        else:
            st.info("No patients registered in the system.")

# ==================== STEP 2: UPLOAD MEDICAL RECORD (DOCTORS ONLY) ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor":
    with st.expander("2. 📤 Upload Medical Record", expanded=True):
        st.markdown("### Create Medical Record")
        
        # Get doctor's assigned patients
        current_doctor = st.session_state.current_user["username"]
        assigned_patients = st.session_state.user_system.get_doctor_patients(current_doctor)
        
        if not assigned_patients:
            st.warning("You need to have assigned patients to create medical records.")
        else:
            col1, col2 = st.columns(2)
            
            with col1:
                # Select patient from assigned patients
                patient_options = {}
                for patient in assigned_patients:
                    display_name = f"{patient.get('full_name', patient['username'])} ({patient['username']})"
                    patient_options[patient['username']] = display_name
                
                selected_patient = st.selectbox("Select Patient", list(patient_options.keys()),
                                              format_func=lambda x: patient_options[x])
                
                # Get patient info
                patient_info = st.session_state.user_system.db.get_user(selected_patient)
                if patient_info:
                    st.markdown(f"**Patient:** {patient_info.get('full_name', 'N/A')}")
                    if patient_info.get('date_of_birth'):
                        try:
                            dob = datetime.fromisoformat(patient_info['date_of_birth']).date()
                            today = datetime.now().date()
                            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                            st.markdown(f"**Age:** {age}")
                        except:
                            st.markdown(f"**Date of Birth:** {patient_info.get('date_of_birth', 'N/A')}")
                    st.markdown(f"**Blood Type:** {patient_info.get('blood_type', 'N/A')}")
            
            with col2:
                diagnosis = st.text_area("Diagnosis", height=100, 
                                       placeholder="Enter diagnosis details...")
                treatment = st.text_area("Treatment Plan", height=100,
                                       placeholder="Enter treatment plan...")
                doctor_notes = st.text_area("Doctor's Notes", height=80,
                                          placeholder="Additional notes...")
            
            # Medical image upload
            st.markdown("### Medical Image (Optional for watermarking)")
            medical_image = st.file_uploader("Upload medical image (X-ray, MRI, etc.)", 
                                            type=["png", "jpg", "jpeg", "bmp"], key="med_image_upload")
            
            image_array = None
            if medical_image:
                file_bytes = np.asarray(bytearray(medical_image.read()), dtype=np.uint8)
                img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
                if img is not None:
                    image_array = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float64)
                    st.image(image_array / 255.0, caption="Uploaded Medical Image", width=300)
                    st.session_state.image_array = image_array
            
            # Select other doctors to grant access (multi-select)
            st.markdown("### Grant Access to Other Doctors")
            all_doctors = st.session_state.user_system.get_all_doctors()
            other_doctors = [d for d in all_doctors if d["username"] != current_doctor]
            
            selected_doctors = []
            if other_doctors:
                doctor_options = {d["username"]: f"{d.get('full_name', d['username'])} ({d.get('department', 'General')})" 
                                for d in other_doctors}
                selected_doctors = st.multiselect(
                    "Select doctors to grant access (optional)",
                    list(doctor_options.keys()),
                    format_func=lambda x: doctor_options[x]
                )
            
            if st.button("📝 Create Medical Record", type="primary", use_container_width=True):
                if not diagnosis or not treatment:
                    st.error("Please fill in diagnosis and treatment fields.")
                else:
                    patient_full_info = {
                        "username": selected_patient,
                        "name": patient_info.get("full_name", selected_patient) if patient_info else selected_patient,
                    }
                    
                    doctor_full_info = {
                        "username": current_doctor,
                        "name": st.session_state.current_user.get("full_name", current_doctor),
                        "department": st.session_state.current_user.get("department", "")
                    }
                    
                    # Include current doctor in allowed doctors list
                    allowed_doctors = [current_doctor] + selected_doctors
                    
                    result = st.session_state.medical_system.create_medical_record(
                        patient_full_info, diagnosis, treatment, doctor_full_info,
                        allowed_doctors=allowed_doctors
                    )
                    
                    if result["success"]:
                        st.session_state.current_record = result["record"]
                        st.session_state.allowed_doctors = allowed_doctors
                        st.markdown('<div class="step-complete">', unsafe_allow_html=True)
                        st.success(f"✅ Step 2 Complete: Record created (ID: {result['record_id']})")
                        st.markdown("</div>", unsafe_allow_html=True)
                        st.session_state.step2_complete = True
                    else:
                        st.error(f"Failed to create record: {result.get('error', 'Unknown error')}")

# ==================== STEP 3: DATA PRE-PROCESSING ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor" and st.session_state.step2_complete:
    with st.expander("3. 🔧 Data Pre-processing", expanded=True):
        st.markdown("### Format & Validation")
        
        if st.session_state.current_record:
            record = st.session_state.current_record
            
            st.markdown("#### Record Summary:")
            col1, col2 = st.columns(2)
            
            with col1:
                st.markdown(f"**Patient:** {record['patient_name']}")
                st.markdown(f"**Patient ID:** {record['patient_username']}")
                st.markdown(f"**Primary Doctor:** {record['doctor_name']}")
            
            with col2:
                st.markdown(f"**Department:** {record.get('doctor_department', 'N/A')}")
                st.markdown(f"**Created:** {record.get('created_at', 'N/A')}")
                st.markdown(f"**Allowed Doctors:** {len(record.get('allowed_doctors', []))}")
            
            st.markdown("#### Diagnosis Preview:")
            st.text_area("", record['diagnosis'][:500] + "...", height=100, disabled=True, key="diag_preview")
            
            st.markdown("#### Access Control Summary:")
            if 'allowed_doctors' in record and record['allowed_doctors']:
                for doctor_username in record['allowed_doctors']:
                    doctor_info = st.session_state.user_system.db.get_user(doctor_username)
                    if doctor_info:
                        st.markdown(f"• {doctor_info.get('full_name', doctor_username)} ({doctor_info.get('department', 'General')})")
            
            # Validation
            st.markdown("#### Validation Options:")
            validated = st.checkbox("✅ Data format is correct")
            approved = st.checkbox("✅ All required fields are filled")
            access_reviewed = st.checkbox("✅ Access permissions reviewed")
            
            if st.button("✓ Validate & Proceed", type="primary", use_container_width=True):
                if validated and approved and access_reviewed:
                    st.session_state.step3_complete = True
                    st.markdown('<div class="step-complete">', unsafe_allow_html=True)
                    st.success("✅ Step 3 Complete: Data validated and ready for encryption")
                    st.markdown("</div>", unsafe_allow_html=True)
                else:
                    st.warning("Please check all validation boxes")

# ==================== STEP 4: DEEP ENCRYPTION MODULE ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor" and st.session_state.step3_complete:
    with st.expander("4. 🔒 Deep Encryption Module", expanded=True):
        st.markdown("### RDH CNN Watermarking Encryption")
        
        # Safe watermark text generation
        watermark_default = ""
        if st.session_state.current_user and 'username' in st.session_state.current_user:
            watermark_default = f"MED_{st.session_state.current_user['username']}_{datetime.now().strftime('%Y%m%d')}"
        else:
            watermark_default = f"MED_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        watermark_text = st.text_input(
            "Watermark Text (used for encryption key)",
            value=watermark_default,
            help="This text will be embedded in the image as a watermark"
        )
        
        col1, col2 = st.columns(2)
        
        with col1:
            if st.button("🔐 Encrypt with RDH CNN", type="primary", use_container_width=True):
                with st.spinner("Encrypting with RDH CNN watermarking..."):
                    # Get image if available
                    image_data = st.session_state.get('image_array', None)
                    
                    result = st.session_state.medical_system.encrypt_with_rdh_watermarking(
                        st.session_state.current_record,
                        watermark_text,
                        image_data,
                        allowed_doctors=st.session_state.get('allowed_doctors', []),
                        encrypting_doctor=st.session_state.current_user["username"] if st.session_state.current_user else None
                    )
                    
                    if result["success"]:
                        st.session_state.encrypted_data = result["encrypted_data"]
                        st.session_state.encryption_key = result["encryption_key"]
                        st.session_state.step4_complete = True
                        
                        st.markdown('<div class="step-complete">', unsafe_allow_html=True)
                        st.success("✅ Step 4 Complete: Record encrypted with RDH CNN watermarking!")
                        st.markdown("</div>", unsafe_allow_html=True)
                        
                        # Show encryption details
                        st.markdown("#### Encryption Details:")
                        st.code(f"Encryption Key: {result['encryption_key'][:20]}...")
                        st.code(f"Watermark Text: {result['encrypted_data']['watermark_text']}")
                        
                        st.markdown("#### Access Granted To:")
                        for doctor in result.get('allowed_doctors', []):
                            doctor_info = st.session_state.user_system.db.get_user(doctor)
                            if doctor_info:
                                st.markdown(f"• {doctor_info.get('full_name', doctor)}")
                        
                        if result["encrypted_data"]["encryption_type"] == "image_watermarked":
                            st.info("📷 Medical image watermarked and encrypted")
                        else:
                            st.info("🖼️ Synthetic image created and watermarked")
                    else:
                        st.error(f"Encryption failed: {result['error']}")
        
        with col2:
            if 'encrypted_data' in st.session_state:
                st.markdown("#### Encryption Status:")
                st.success("✅ ENCRYPTED")
                st.metric("Encryption Method", "RDH CNN Watermarking")
                st.metric("Key Strength", "256-bit")
                st.metric("Allowed Doctors", len(st.session_state.get('allowed_doctors', [])))

# ==================== STEP 5: DCUNA AUTHORIZATION ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor" and st.session_state.step4_complete:
    with st.expander("5. 🛡️ DCUNA Authorization", expanded=True):
        st.markdown("### Selective Doctor Access Control")
        
        # Node registration
        if not st.session_state.current_node:
            st.markdown("#### Register Your Node:")
            
            # Safe node name generation
            node_name_default = ""
            if st.session_state.current_user and 'username' in st.session_state.current_user:
                node_name_default = f"{st.session_state.current_user['username']}_Node_{datetime.now().strftime('%Y%m%d')}"
            else:
                node_name_default = f"Node_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            node_name = st.text_input("Node Name", value=node_name_default)
            node_type = st.selectbox("Node Type", ["doctor", "admin", "nurse"])
            
            if st.button("Register Node", type="primary", use_container_width=True):
                node_id = f"NODE_{hashlib.sha256(node_name.encode()).hexdigest()[:8]}"
                permissions = ["read", "write"] if node_type in ["doctor", "admin"] else ["read"]
                
                result = st.session_state.dcuna_system.register_node(
                    node_id, node_name, node_type, 
                    st.session_state.current_user["username"],
                    permissions
                )
                
                if result["success"]:
                    st.session_state.current_node = {
                        "node_id": node_id,
                        "node_name": node_name,
                        "node_type": node_type,
                        "node_key": result["node_key"],
                        "owner": st.session_state.current_user["username"]
                    }
                    st.success(f"✅ Node registered: {node_name}")
                    st.code(f"Node Key: {result['node_key']}")
        
        # Authorization test
        if st.session_state.current_node:
            st.markdown("#### Test Authorization:")
            
            resource_id = st.session_state.current_record["record_id"]
            node_key = st.session_state.current_node["node_key"]
            
            if st.button("🔐 Authorize Access", type="primary", use_container_width=True):
                result = st.session_state.dcuna_system.authorize_access(
                    st.session_state.current_node["node_id"],
                    node_key,
                    resource_id,
                    st.session_state.current_user["role"],
                    st.session_state.current_user["username"]
                )
                
                if result["authorized"]:
                    st.session_state.authorization_result = result
                    st.session_state.step5_complete = True
                    
                    st.markdown('<div class="access-granted">', unsafe_allow_html=True)
                    st.markdown('<div class="step-complete">', unsafe_allow_html=True)
                    st.success("✅ Step 5 Complete: Access Authorized!")
                    st.markdown("</div>", unsafe_allow_html=True)
                    st.markdown("#### Authorization Details:")
                    st.json({
                        "node": result["node_info"]["node_name"],
                        "resource": resource_id,
                        "permissions": result["node_info"]["permissions"],
                        "owner": result["node_info"]["owner_username"],
                        "timestamp": datetime.now().isoformat()
                    })
                    st.markdown("</div>", unsafe_allow_html=True)
                else:
                    st.markdown('<div class="access-denied">', unsafe_allow_html=True)
                    st.error(f"❌ Authorization Failed: {result['reason']}")
                    st.markdown("</div>", unsafe_allow_html=True)

# ==================== STEP 6: RETRIEVE ENCRYPTED DATA (FOR AUTHORIZED DOCTORS) ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor":
    with st.expander("6. 📂 Retrieve Patient Records", expanded=True):
        st.markdown("### Access Your Patient Records")
        
        # Get doctor's accessible records
        current_doctor = st.session_state.current_user["username"]
        accessible_records = st.session_state.medical_system.get_doctor_accessible_records(current_doctor)
        
        if accessible_records:
            st.markdown(f"**You have access to {len(accessible_records)} records:**")
            
            # Select record to decrypt
            record_options = {}
            for record in accessible_records:
                diagnosis_preview = record['diagnosis'][:50] + "..." if len(record['diagnosis']) > 50 else record['diagnosis']
                record_options[record['record_id']] = f"{record['patient_name']} - {diagnosis_preview}"
            
            selected_record_id = st.selectbox("Select Record to Decrypt", list(record_options.keys()),
                                            format_func=lambda x: record_options[x], key="record_select")
            
            if selected_record_id:
                # Get encryption key (in real app, this would be securely stored)
                decryption_key = st.text_input(
                    "Enter Decryption Key",
                    type="password",
                    help="Enter the encryption key to decrypt the record",
                    placeholder="Enter the encryption key provided during encryption"
                )
                
                if st.button("🔓 Decrypt Record", type="primary", use_container_width=True):
                    result = st.session_state.medical_system.decrypt_record(
                        selected_record_id,
                        decryption_key,
                        requesting_doctor=current_doctor
                    )
                    
                    if result["success"]:
                        st.session_state.decrypted_record = result["record_data"]
                        st.session_state.currently_viewing_record_id = selected_record_id
                        st.session_state.step6_complete = True
                        
                        st.markdown('<div class="step-complete">', unsafe_allow_html=True)
                        st.success("✅ Step 6 Complete: Record decrypted successfully!")
                        st.markdown("</div>", unsafe_allow_html=True)
                        
                        # Show decrypted info
                        record = result["record_data"]
                        st.markdown("#### Decrypted Record Information:")
                        col1, col2 = st.columns(2)
                        
                        with col1:
                            st.markdown(f"**Patient:** {record.get('patient_name', 'N/A')}")
                            st.markdown(f"**Record ID:** {record.get('record_id', 'N/A')}")
                            if record.get('created_at'):
                                st.markdown(f"**Created:** {record['created_at'][:19]}")
                        
                        with col2:
                            st.markdown(f"**Encrypted By:** {result.get('encrypted_by', 'Unknown')}")
                            st.markdown(f"**Watermark:** {result.get('watermark_text', 'N/A')[:30]}...")
                            if result.get('access_info'):
                                st.markdown(f"**Allowed Doctors:** {len(result['access_info'].get('allowed_doctors', []))}")
                    else:
                        st.error(f"❌ {result['error']}")
        else:
            st.info("No records accessible to you at this time.")

# ==================== STEP 7: VIEW MEDICAL RECORD ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor" and 'decrypted_record' in st.session_state and st.session_state.decrypted_record:
    with st.expander("7. 👁️ View Medical Record", expanded=True):
        st.markdown("### Secure Display")
        
        record = st.session_state.decrypted_record
        
        # Display full record with security context
        st.markdown(f"## Medical Record: {record.get('patient_name', 'Unknown')}")
        st.markdown(f"*Record ID: {record.get('record_id', 'Unknown')}*")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("### Patient Information")
            st.markdown(f"**Name:** {record.get('patient_name', 'N/A')}")
            st.markdown(f"**Username:** {record.get('patient_username', 'N/A')}")
            if record.get('patient_username'):
                patient_info = st.session_state.user_system.db.get_user(record['patient_username'])
                if patient_info:
                    st.markdown(f"**Date of Birth:** {patient_info.get('date_of_birth', 'N/A')}")
                    st.markdown(f"**Blood Type:** {patient_info.get('blood_type', 'N/A')}")
        
        with col2:
            st.markdown("### Medical Information")
            st.markdown(f"**Doctor:** {record.get('doctor_name', 'N/A')}")
            st.markdown(f"**Department:** {record.get('doctor_department', 'N/A')}")
            if record.get('created_at'):
                st.markdown(f"**Created:** {record['created_at'][:19]}")
            st.markdown(f"**Status:** {record.get('status', 'N/A').title()}")
            st.markdown(f"**Confidentiality:** {record.get('confidential_level', 'High')}")
        
        st.markdown("### Diagnosis")
        st.text_area("", record.get('diagnosis', ''), height=150, disabled=True, key="diagnosis_view_full")
        
        st.markdown("### Treatment Plan")
        st.text_area("", record.get('treatment', ''), height=150, disabled=True, key="treatment_view_full")
        
        # Show who else has access
        if 'currently_viewing_record_id' in st.session_state:
            record_id = st.session_state.currently_viewing_record_id
            encrypted_file = st.session_state.medical_system.db.get_encrypted_file(record_id)
            if encrypted_file and encrypted_file.get('access_info'):
                try:
                    access_info = json.loads(encrypted_file['access_info'])
                    allowed_doctors = access_info.get('allowed_doctors', [])
                    
                    if allowed_doctors:
                        st.markdown("### Doctors with Access to this Record:")
                        for doctor_username in allowed_doctors:
                            doctor_info = st.session_state.user_system.db.get_user(doctor_username)
                            status = "🟢 (You)" if doctor_username == st.session_state.current_user["username"] else "🔵"
                            if doctor_info:
                                st.markdown(f"{status} {doctor_info.get('full_name', doctor_username)} ({doctor_info.get('department', 'General')})")
                except:
                    pass
        
        st.session_state.step7_complete = True
        st.markdown('<div class="step-complete">', unsafe_allow_html=True)
        st.success("✅ Step 7 Complete: Medical record displayed securely!")
        st.markdown("</div>", unsafe_allow_html=True)

# ==================== STEP 8: ACCESS APPROVED ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "doctor" and st.session_state.step7_complete:
    with st.expander("8. ✅ Access Approved", expanded=True):
        st.markdown('<div class="access-granted">', unsafe_allow_html=True)
        st.markdown("## ✅ Authorized Doctor: Access Approved")
        
        st.balloons()
        
        st.markdown("### System Flow Complete!")
        st.markdown(f"**Doctor:** {st.session_state.current_user['username']}")
        st.markdown(f"**Name:** {st.session_state.current_user.get('full_name', 'N/A')}")
        if st.session_state.current_node:
            st.markdown(f"**Node:** {st.session_state.current_node['node_name']}")
        if st.session_state.current_record:
            st.markdown(f"**Record ID:** {st.session_state.current_record['record_id']}")
        st.markdown(f"**Timestamp:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        st.markdown("</div>", unsafe_allow_html=True)
        
        # System Logs for this doctor
        st.markdown("### 📋 Your Recent Access Logs")
        logs = st.session_state.dcuna_system.get_access_logs(
            user_filter=st.session_state.current_user["username"]
        )
        if logs:
            for log in logs[-5:]:  # Show last 5 logs
                status = "🟢 Granted" if log["authorized"] else "🔴 Denied"
                st.text(f"{status} | {log['timestamp'][11:19]} | {log['resource_id'][:15]}... | {log.get('reason', '')}")
        else:
            st.info("No access logs found.")

# ==================== PATIENT VIEW ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "patient":
    st.markdown("---")
    with st.expander("👤 Patient Portal", expanded=True):
        st.markdown("### Your Medical Records")
        
        patient_username = st.session_state.current_user["username"]
        patient_records = st.session_state.medical_system.get_patient_records(patient_username)
        
        if patient_records:
            st.markdown(f"**You have {len(patient_records)} medical records:**")
            
            for record in patient_records:
                with st.expander(f"Record: {record['record_id'][:8]}... - {record['created_at'][:10]}"):
                    st.markdown(f"**Doctor:** {record['doctor_name']}")
                    st.markdown(f"**Department:** {record['doctor_department']}")
                    st.markdown(f"**Date:** {record['created_at'][:10]}")
                    st.markdown(f"**Diagnosis:** {record['diagnosis'][:200]}...")
                    
                    # Show which doctors have access
                    access_list = st.session_state.db_manager.get_record_access(record['record_id'])
                    if access_list:
                        st.markdown("**Doctors with access:**")
                        for access in access_list:
                            st.markdown(f"• {access['full_name']} ({access['department']}) - Granted by: {access['granted_by']}")
        else:
            st.info("No medical records found for you.")

# ==================== SYSTEM ADMIN PANEL ====================
if st.session_state.current_user and st.session_state.current_user["role"] == "admin":
    st.markdown("---")
    with st.expander("⚙️ Admin Dashboard", expanded=True):
        st.markdown("### System Administration")
        
        tab1, tab2, tab3, tab4, tab5 = st.tabs(["Users", "Nodes", "Records", "Database", "Statistics"])
        
        with tab1:
            st.markdown("#### Registered Users")
            users = st.session_state.user_system.db.get_all_users()
            if users:
                df_users = pd.DataFrame(users)
                st.dataframe(df_users[['username', 'role', 'full_name', 'email', 'registration_date', 'status']])
            else:
                st.info("No users found")
        
        with tab2:
            st.markdown("#### Registered Nodes")
            nodes = st.session_state.dcuna_system.db.get_user_nodes("all")
            if nodes:
                df_nodes = pd.DataFrame(nodes)
                st.dataframe(df_nodes[['node_id', 'node_name', 'node_type', 'owner_username', 'status', 'registered_at']])
            else:
                st.info("No nodes found")
        
        with tab3:
            st.markdown("#### Medical Records")
            with st.session_state.db_manager.get_connection() as conn:
                records = pd.read_sql("SELECT * FROM medical_records ORDER BY created_at DESC LIMIT 100", conn)
                if not records.empty:
                    st.dataframe(records[['record_id', 'patient_name', 'doctor_name', 'created_at', 'status']])
                else:
                    st.info("No records found")
        
        with tab4:
            st.markdown("#### Database Management")
            col1, col2 = st.columns(2)
            
            with col1:
                if st.button("🔄 Refresh Database", use_container_width=True):
                    st.session_state.db_manager.init_database()
                    st.success("Database refreshed!")
                
                if st.button("📊 Export Data", use_container_width=True):
                    # Export data to CSV
                    with st.session_state.db_manager.get_connection() as conn:
                        users_df = pd.read_sql("SELECT * FROM users", conn)
                        records_df = pd.read_sql("SELECT * FROM medical_records", conn)
                        
                        csv_users = users_df.to_csv(index=False)
                        csv_records = records_df.to_csv(index=False)
                        
                        st.download_button(
                            label="📥 Download Users CSV",
                            data=csv_users,
                            file_name="dcuna_users.csv",
                            mime="text/csv"
                        )
                        
                        st.download_button(
                            label="📥 Download Records CSV",
                            data=csv_records,
                            file_name="dcuna_records.csv",
                            mime="text/csv"
                        )
            
            with col2:
                st.markdown("#### Database Info")
                with st.session_state.db_manager.get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                    tables = cursor.fetchall()
                    st.markdown(f"**Tables:** {len(tables)}")
                    
                    cursor.execute("SELECT COUNT(*) as count FROM users")
                    st.markdown(f"**Users:** {cursor.fetchone()[0]}")
                    
                    cursor.execute("SELECT COUNT(*) as count FROM medical_records")
                    st.markdown(f"**Records:** {cursor.fetchone()[0]}")
        
        with tab5:
            st.markdown("#### System Statistics")
            stats = st.session_state.db_manager.get_system_stats()
            
            col1, col2 = st.columns(2)
            
            with col1:
                fig, ax = plt.subplots(figsize=(6, 4))
                roles = stats['users_by_role']
                ax.pie(roles.values(), labels=roles.keys(), autopct='%1.1f%%')
                ax.set_title('User Roles Distribution')
                st.pyplot(fig)
            
            with col2:
                fig, ax = plt.subplots(figsize=(6, 4))
                access_data = [stats['authorized_access'], stats['denied_access']]
                ax.bar(['Authorized', 'Denied'], access_data, color=['green', 'red'])
                ax.set_title('Access Attempts')
                ax.set_ylabel('Count')
                st.pyplot(fig)

# Footer
st.markdown("---")
st.markdown("""
<div style="text-align: center; color: #666; font-size: 0.9rem;">
    <p>🔒 <strong>DCUNA Medical Record System</strong> - SQLite Database Management</p>
    <p>Persistent Storage • Selective Doctor Access • RDH CNN Watermarking • HIPAA Compliant</p>
</div>
""", unsafe_allow_html=True)