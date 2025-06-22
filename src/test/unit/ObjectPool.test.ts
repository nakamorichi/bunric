/**
 * Tests for Phase 1 Foundation Optimizations
 * Object Pool implementation tests
 */

import { describe, test, expect } from 'bun:test';
import { ObjectPool, BufferPool } from '../../pkg/utils/ObjectPool.ts';
import { poolManager } from '../../pkg/utils/PoolManager.ts';
import { efficientLogger, LogLevel } from '../../pkg/utils/EfficientLogger.ts';

// Simple poolable object for testing
class TestPoolableObject {
  public value: string = '';
  
  constructor(initialValue: string = '') {
    this.value = initialValue;
  }
  
  reset(): void {
    this.value = '';
  }
  
  setValue(value: string): void {
    this.value = value;
  }
}

describe('ObjectPool', () => {
  test('should create and reuse objects', () => {
    const pool = new ObjectPool(() => new TestPoolableObject('default'), 5);
    
    // Acquire first object
    const obj1 = pool.acquire();
    obj1.setValue('test1');
    expect(obj1.value).toBe('test1');
    
    // Release it back to pool
    pool.release(obj1);
    
    // Acquire again - should get the same object (reset)
    const obj2 = pool.acquire();
    expect(obj2.value).toBe(''); // Should be reset
    expect(obj2).toBe(obj1); // Should be the same object instance
    
    // Check stats
    const stats = pool.getStats();
    expect(stats.created).toBe(1);
    expect(stats.acquired).toBe(2);
    expect(stats.released).toBe(1);
    expect(stats.hitRate).toBe(0.5); // 1 hit out of 2 acquisitions
  });

  test('should create new objects when pool is empty', () => {
    const pool = new ObjectPool(() => new TestPoolableObject(), 2);
    
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    const obj3 = pool.acquire(); // Should create new since pool is empty
    
    expect(obj1).not.toBe(obj2);
    expect(obj2).not.toBe(obj3);
    
    const stats = pool.getStats();
    expect(stats.created).toBe(3);
    expect(stats.acquired).toBe(3);
  });
});

describe('BufferPool', () => {
  test('should reuse buffers of correct size', () => {
    const pool = new BufferPool(1024, 3); // 1KB buffers, max 3
    
    const buffer1 = pool.acquire();
    expect(buffer1.byteLength).toBe(1024);
    
    // Release and acquire again
    pool.release(buffer1);
    const buffer2 = pool.acquire();
    
    expect(buffer2).toBe(buffer1); // Should be the same buffer
    expect(pool.availableCount).toBe(0); // Should be empty now
  });

  test('should ignore buffers of wrong size', () => {
    const pool = new BufferPool(1024, 3);
    
    const wrongSizeBuffer = new ArrayBuffer(2048);
    pool.release(wrongSizeBuffer);
    
    expect(pool.availableCount).toBe(0); // Should not accept wrong size
  });
});

describe('PoolManager', () => {
  test('should manage InvokeContext pool', () => {
    // Clear pools first
    poolManager.clearAll();
    
    const headers = { 'lambda-runtime-aws-request-id': 'test-123' };
    const context1 = poolManager.getInvokeContext(headers);
    
    expect(context1.invokeId).toBe('test-123');
    
    // Release and get another
    poolManager.releaseInvokeContext(context1);
    const context2 = poolManager.getInvokeContext({ 'lambda-runtime-aws-request-id': 'test-456' });
    
    expect(context2.invokeId).toBe('test-456');
    expect(context2).toBe(context1); // Should be the same object, reused
  });

  test('should manage error pools', () => {
    poolManager.clearAll();
    
    const error1 = poolManager.getError('Test error', 'TestError');
    expect(error1.message).toBe('Test error');
    expect(error1.name).toBe('TestError');
    
    poolManager.releaseError(error1);
    
    const error2 = poolManager.getError('Another error', 'AnotherError');
    expect(error2.message).toBe('Another error');
    expect(error2.name).toBe('AnotherError');
    expect(error2).toBe(error1); // Should be reused
  });

  test('should provide pool statistics', () => {
    poolManager.clearAll();
    
    // Use some objects
    const context = poolManager.getInvokeContext();
    const error = poolManager.getError('test');
    const buffer = poolManager.getBuffer('large');
    
    const stats = poolManager.getStats();
    
    expect(stats.invokeContext.created).toBe(1);
    expect(stats.error.created).toBe(1);
    expect(stats.buffers.large.available).toBe(0); // Buffer pool starts empty
    expect(stats.buffers.small.available).toBe(0); // Buffer pool starts empty
    
    // Release objects
    poolManager.releaseInvokeContext(context);
    poolManager.releaseError(error);
    poolManager.releaseBuffer(buffer);
    
    const statsAfter = poolManager.getStats();
    expect(statsAfter.buffers.large.available).toBe(1); // One buffer returned
  });
});

describe('EfficientLogger', () => {
  test('should log with lazy evaluation', () => {
    efficientLogger.clearLogs();
    efficientLogger.setLevel(LogLevel.INFO);
    
    let expensiveCallCount = 0;
    const expensiveOperation = () => {
      expensiveCallCount++;
      return 'expensive result';
    };
    
    // This should not call the expensive operation (DEBUG > INFO)
    efficientLogger.debug(expensiveOperation);
    expect(expensiveCallCount).toBe(0);
    
    // This should call the expensive operation (ERROR <= INFO)
    efficientLogger.error(expensiveOperation);
    expect(expensiveCallCount).toBe(1);
    
    const logs = efficientLogger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('[ERROR] expensive result');
  });

  test('should support sampling', () => {
    efficientLogger.clearLogs();
    efficientLogger.setLevel(LogLevel.INFO);
    efficientLogger.setSampleRate(0.5); // 50% sampling
    
    // Log many messages
    for (let i = 0; i < 100; i++) {
      efficientLogger.info(`Message ${i}`);
    }
    
    const logs = efficientLogger.getLogs();
    // Should have roughly 50% of messages (allow some variance)
    expect(logs.length).toBeGreaterThan(30);
    expect(logs.length).toBeLessThan(70);
    
    // Reset sample rate
    efficientLogger.setSampleRate(1.0);
  });

  test('should handle ring buffer overflow', () => {
    const smallLogger = new (efficientLogger.constructor as any)(LogLevel.INFO, 5); // 5 message buffer
    
    // Add more messages than buffer size
    for (let i = 0; i < 10; i++) {
      smallLogger.info(`Message ${i}`);
    }
    
    const logs = smallLogger.getLogs();
    expect(logs).toHaveLength(5); // Should only keep last 5
    expect(logs[0]).toContain('Message 5'); // Should start from message 5
    expect(logs[4]).toContain('Message 9'); // Should end with message 9
  });
});
