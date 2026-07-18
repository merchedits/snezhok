package xyz.merchedits.snezhok.transfer

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class UploadProtocolTest {
  @Test fun acceptsOnlyCredentialFreeHttpsApiOrigins() {
    assertEquals("https://merchedits.xyz/chat/api/v1", UploadProtocol.validatedBaseUrl("https://merchedits.xyz/chat/api/v1/"))
    for (invalid in listOf(
      "http://merchedits.xyz/chat/api/v1",
      "https://user:password@merchedits.xyz/chat/api/v1",
      "https://merchedits.xyz/chat/api/v1?secret=x",
      "not a url",
    )) {
      try {
        UploadProtocol.validatedBaseUrl(invalid)
        fail("Expected URL to be rejected: $invalid")
      } catch (_: IllegalArgumentException) {
        // expected
      }
    }
  }
}
