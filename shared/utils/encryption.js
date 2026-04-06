const crypto = require('crypto');
const logger = require('./logger');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;
    
    this.masterKey = this.deriveMasterKey();
  }

  deriveMasterKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 32 characters long');
    }
    return Buffer.from(key, 'utf8');
  }

  generateDataKey() {
    return crypto.randomBytes(this.keyLength);
  }

  encryptDataKey(dataKey) {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipher(this.algorithm, this.masterKey);
    cipher.setAAD(Buffer.from('data-key'));
    
    let encrypted = cipher.update(dataKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();
    
    return {
      encryptedDataKey: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64')
    };
  }

  decryptDataKey(encryptedDataKey, iv, tag) {
    const decipher = crypto.createDecipher(this.algorithm, this.masterKey);
    decipher.setAAD(Buffer.from('data-key'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    
    let decrypted = decipher.update(Buffer.from(encryptedDataKey, 'base64'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  }

  encryptField(plaintext, dataKey) {
    if (!plaintext) return null;
    
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipher(this.algorithm, dataKey);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();
    
    return {
      data: encrypted,
      iv: iv.toString('base64'),
      tag: tag.toString('base64')
    };
  }

  decryptField(encryptedField, dataKey) {
    if (!encryptedField) return null;
    
    const decipher = crypto.createDecipher(this.algorithm, dataKey);
    decipher.setAuthTag(Buffer.from(encryptedField.tag, 'base64'));
    
    let decrypted = decipher.update(encryptedField.data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  encryptSensitiveData(data) {
    try {
      const dataKey = this.generateDataKey();
      const encryptedDataKey = this.encryptDataKey(dataKey);
      
      const encrypted = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== null && value !== undefined) {
          encrypted[key] = this.encryptField(String(value), dataKey);
        }
      }
      
      return {
        encrypted,
        encryptedDataKey
      };
    } catch (error) {
      logger.error('Encryption failed', { error: error.message });
      throw new Error('Failed to encrypt sensitive data');
    }
  }

  decryptSensitiveData(encryptedData, encryptedDataKey) {
    try {
      const dataKey = this.decryptDataKey(
        encryptedDataKey.encryptedDataKey,
        Buffer.from(encryptedDataKey.iv, 'base64'),
        Buffer.from(encryptedDataKey.tag, 'base64')
      );
      
      const decrypted = {};
      for (const [key, value] of Object.entries(encryptedData)) {
        if (value !== null && value !== undefined) {
          decrypted[key] = this.decryptField(value, dataKey);
        }
      }
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', { error: error.message });
      throw new Error('Failed to decrypt sensitive data');
    }
  }
}

module.exports = new EncryptionService();
