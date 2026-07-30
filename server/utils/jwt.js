/**
 * jwt.js
 * ------------------------------------------------------------
 * Generazione e verifica dei JSON Web Token.
 * ------------------------------------------------------------
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

/** Firma un token con il payload dato (tipicamente { id, role }). */
export function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

/** Verifica un token e restituisce il payload, o lancia un errore. */
export function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}
