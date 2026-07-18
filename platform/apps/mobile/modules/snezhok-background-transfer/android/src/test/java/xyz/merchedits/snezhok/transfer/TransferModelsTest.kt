package xyz.merchedits.snezhok.transfer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferModelsTest {
  @Test fun progressIsBoundedAndStable() {
    assertEquals(0, transferPercent(-5, 100))
    assertEquals(61, transferPercent(61, 100))
    assertEquals(100, transferPercent(150, 100))
    assertEquals(0, transferPercent(5, 0))
  }

  @Test fun chunkSizeIsBoundedForLowMemoryDevices() {
    assertEquals(64 * 1024, normalizedChunkBytes(1))
    assertEquals(512 * 1024, normalizedChunkBytes(512 * 1024))
    assertEquals(1024 * 1024, normalizedChunkBytes(8 * 1024 * 1024))
  }

  @Test fun retryPolicyDoesNotRetryClientAuthorizationFailures() {
    assertTrue(retryableHttpStatus(408))
    assertTrue(retryableHttpStatus(429))
    assertTrue(retryableHttpStatus(503))
    assertFalse(retryableHttpStatus(401))
    assertFalse(retryableHttpStatus(404))
  }
}
