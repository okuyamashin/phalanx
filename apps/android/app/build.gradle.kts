plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "jp.engawa.phalanx"
    compileSdk = 35

    defaultConfig {
        applicationId = "jp.engawa.phalanx"
        minSdk = 31 // Android 12 以上（Bluetooth の許可の仕組みがそろう）
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
