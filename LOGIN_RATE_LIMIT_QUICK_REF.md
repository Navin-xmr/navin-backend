# 🔒 Login Rate Limiting - Quick Reference

## Overview
Prevents brute-force attacks by limiting failed login attempts to 5 per 15 minutes per IP address.

## Configuration

```typescript
// src/shared/middleware/rateLimiter.ts
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,      // 15 minutes
  limit: 5,                       // 5 attempts
  skipSuccessfulRequests: true,   // Only count failures
  message: { 
    success: false, 
    message: 'Too many login attempts, please try again later.' 
  },
});
```

## Behavior

| Attempt | Status | Response |
|---------|--------|----------|
| 1-5 (failed) | 401 | Invalid credentials |
| 6+ (failed) | 429 | Too many requests |
| Any (success) | 200 | Login successful (doesn't count) |

## Response Headers

```
RateLimit-Limit: 5
RateLimit-Remaining: 3
RateLimit-Reset: 1704067200
```

## Testing

```bash
# Run tests
npm test -- login-rate-limit.test.ts

# Manual test (should get 429 on 6th attempt)
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done
```

## Example Response (429)

```json
{
  "success": false,
  "message": "Too many login attempts, please try again later."
}
```

## Key Features

✅ Per-IP rate limiting  
✅ Only counts failed attempts  
✅ 15-minute sliding window  
✅ Standard rate limit headers  
✅ Prevents brute-force attacks  
✅ Prevents credential stuffing  

## Files Modified

- `src/shared/middleware/rateLimiter.ts` - Added loginLimiter
- `src/app.ts` - Applied to /api/auth/login
- `tests/login-rate-limit.test.ts` - Test suite

## Security Impact

- **Before**: Unlimited login attempts possible
- **After**: Maximum 5 failed attempts per 15 minutes per IP

---

**Status**: ✅ Production Ready
