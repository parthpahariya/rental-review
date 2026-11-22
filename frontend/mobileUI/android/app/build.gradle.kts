plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// The site release builds talk to; CI may override it with APP_BASE_URL (an HTTPS origin).
val releaseBaseUrl = (providers.environmentVariable("APP_BASE_URL").orNull?.trim()?.trimEnd('/')
    ?.takeIf { it.isNotEmpty() } ?: "https://rentalreview.boringman.in").also {
    require(Regex("^https://[^/\\s]+$").matches(it)) { "APP_BASE_URL must be an HTTPS origin without a path" }
}

// Release signing and store versions come from CI (ci/android.sh); local builds keep the defaults.
val releaseKeystore: String? = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
fun requiredEnv(name: String): String =
    providers.environmentVariable(name).orNull ?: error("$name is required when ANDROID_KEYSTORE_PATH is set")

android {
    namespace = "com.boringman.rentalreview"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.boringman.rentalreview"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.environmentVariable("ANDROID_VERSION_CODE").orNull?.toInt() ?: 1
        versionName = providers.environmentVariable("ANDROID_VERSION_NAME").orNull ?: "1.0.0"
        // The public site: legal pages and links open here.
        buildConfigField("String", "SITE_URL", "\"https://rentalreview.boringman.in\"")
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = requiredEnv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = requiredEnv("ANDROID_KEY_ALIAS")
                keyPassword = requiredEnv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            // The local stack's web container (it proxies /api to the backend).
            // 10.0.2.2 is the host machine as seen from the Android emulator.
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8088\"")
        }
        release {
            buildConfigField("String", "API_BASE_URL", "\"$releaseBaseUrl\"")
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")

    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    implementation("org.maplibre.gl:android-sdk:13.7.1")

    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")
}
