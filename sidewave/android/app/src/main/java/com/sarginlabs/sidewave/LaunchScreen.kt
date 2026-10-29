package com.sarginlabs.sidewave

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Extends the system launch artwork while the saved account is checked; no artificial delay. */
@Composable
fun AppLaunchScreen() {
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF10291C),Color(0xFF081710)))).windowInsetsPadding(WindowInsets.safeDrawing)) {
        Column(Modifier.align(Alignment.Center),horizontalAlignment=Alignment.CenterHorizontally) {
            Image(painterResource(R.drawable.ic_launcher_foreground),null,Modifier.size(200.dp))
            Text("SIDEWAVE",fontSize=22.sp,fontWeight=FontWeight.Bold,letterSpacing=3.sp,color=Color(0xFFF0FFF5))
            Spacer(Modifier.height(26.dp))
            CircularProgressIndicator(Modifier.size(18.dp),color=Color(0xFF49DF83),strokeWidth=2.dp)
        }
        Text("SARGIN LABS",Modifier.align(Alignment.BottomCenter).padding(28.dp),color=Color(0xFF8CA697),fontSize=10.sp,letterSpacing=3.sp)
    }
}
