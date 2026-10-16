enable_language(C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
add_library(voice-noise SHARED
  ${RNNOISE_SOURCE_DIR}/src/denoise.c
  ${RNNOISE_SOURCE_DIR}/src/rnn.c
  ${RNNOISE_SOURCE_DIR}/src/pitch.c
  ${RNNOISE_SOURCE_DIR}/src/kiss_fft.c
  ${RNNOISE_SOURCE_DIR}/src/celt_lpc.c
  ${RNNOISE_SOURCE_DIR}/src/nnet.c
  ${RNNOISE_SOURCE_DIR}/src/nnet_default.c
  ${RNNOISE_SOURCE_DIR}/src/parse_lpcnet_weights.c
  ${RNNOISE_SOURCE_DIR}/src/rnnoise_data.c
  ${RNNOISE_SOURCE_DIR}/src/rnnoise_tables.c)
target_include_directories(voice-noise PRIVATE ${RNNOISE_SOURCE_DIR}/include ${RNNOISE_SOURCE_DIR}/src)
target_compile_definitions(voice-noise PRIVATE WIN32 RNNOISE_BUILD DLL_EXPORT restrict=__restrict _CRT_SECURE_NO_WARNINGS)
target_compile_options(voice-noise PRIVATE /W0 /arch:AVX2)
