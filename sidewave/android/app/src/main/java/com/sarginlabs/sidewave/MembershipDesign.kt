package com.sarginlabs.sidewave

import android.graphics.Paint
import android.graphics.Typeface
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

private val EntryGreen=Color(0xFF1ED760)
private val EntryBackground=Color(0xFF080C0A)
private val EntryMuted=Color(0xFF9BABA1)

@Composable
private fun entryRotation(): Float {
    val context=LocalContext.current
    val motion=remember(context) { runCatching { Settings.Global.getFloat(context.contentResolver,Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0f }.getOrDefault(true) }
    if(!motion) return 0f
    val transition=rememberInfiniteTransition(label="Record motion")
    val value by transition.animateFloat(0f,360f,infiniteRepeatable(tween(26000,easing=LinearEasing)),label="Record rotation")
    return value
}

@Composable
fun MusicEntryArt(modifier: Modifier=Modifier) {
    val rotation=entryRotation()
    val paint=remember { Paint(Paint.ANTI_ALIAS_FLAG).apply {typeface=Typeface.create("sans-serif-black",Typeface.BOLD)} }
    Canvas(modifier) {
        val factor=min(size.width/460f,size.height/330f)
        withTransform({translate((size.width-460f*factor)/2f,(size.height-330f*factor)/2f);scale(factor,factor,pivot=Offset.Zero)}) {
            val center=Offset(288f,166f)
            drawCircle(Brush.radialGradient(listOf(EntryGreen.copy(alpha=.14f),Color.Transparent),center,210f),210f,center)
            rotate(rotation,pivot=center) {
                drawCircle(Brush.sweepGradient(listOf(Color(0xFF0D1310),Color(0xFF3A403D),Color(0xFF0D1310),Color(0xFF242C27),Color(0xFF0D1310)),center),137f,center)
                repeat(25) { drawCircle(Color.White.copy(alpha=.07f),52f+it*3.2f,center,style=Stroke(.7f)) }
                drawCircle(Color(0xFFE9A24C),43f,center)
                paint.color=android.graphics.Color.rgb(28,39,28);paint.textSize=7f
                drawContext.canvas.nativeCanvas.drawText("SIDEWAVE",center.x-29f,center.y-18f,paint)
                repeat(5) { i-> val h=10f+sin(i*1.8f)*5f;drawLine(Color(0xFF243226),Offset(center.x-12+i*6,center.y-h),Offset(center.x-12+i*6,center.y+h),2.7f) }
                drawCircle(Color(0xFF101713),4f,center)
                paint.textSize=6f;drawContext.canvas.nativeCanvas.drawText("33⅓ RPM",center.x-15f,center.y+27f,paint)
            }
            rotate(-10f+sin(rotation*PI.toFloat()/180f)*2f,pivot=Offset(155f,162f)) {
                drawRoundRect(Color(0xFF78CD7A),Offset(30f,25f),Size(245f,275f),cornerRadius=androidx.compose.ui.geometry.CornerRadius(3f))
                clipRect(30f,25f,275f,300f) {repeat(5) { i->drawCircle(Color(0xFF103724),68f,Offset(211f+i*26,101f+i*30),style=Stroke(20f))}}
                paint.color=android.graphics.Color.rgb(15,46,29);paint.textSize=11f
                drawContext.canvas.nativeCanvas.drawText("SIDEWAVE",48f,52f,paint);drawContext.canvas.nativeCanvas.drawText("SESSIONS",48f,65f,paint)
                paint.textSize=8f;drawContext.canvas.nativeCanvas.drawText("VOL. 01",226f,52f,paint)
                paint.textSize=26f;drawContext.canvas.nativeCanvas.drawText("FEEL",48f,260f,paint);drawContext.canvas.nativeCanvas.drawText("THE SOUND.",48f,284f,paint)
            }
            drawCircle(Color(0xFFDBD653),40f,Offset(398f,269f))
            paint.textSize=10f;paint.color=android.graphics.Color.rgb(18,35,25)
            drawContext.canvas.nativeCanvas.drawText("MUSIC IS",374f,267f,paint);drawContext.canvas.nativeCanvas.drawText("A FEELING.",371f,280f,paint)
        }
    }
}

@Composable private fun EntryEqualizer(modifier:Modifier=Modifier) {
    val phase=entryRotation()
    Canvas(modifier) {repeat(16) { i->val h=size.height*(.2f+.8f*(.5f+.5f*sin(phase*PI.toFloat()/45f+i*.9f)));val x=i*size.width/16f;drawLine(EntryGreen,Offset(x,(size.height-h)/2),Offset(x,(size.height+h)/2),3.dp.toPx())}}
}

@Composable
fun AnimatedMembershipScreen(signup:Boolean,username:String,password:String,confirm:String,server:String,error:String,busy:Boolean,
    onMode:(Boolean)->Unit,onUsername:(String)->Unit,onPassword:(String)->Unit,onConfirm:(String)->Unit,onServer:(String)->Unit,onSubmit:()->Unit,onOffline:()->Unit) {
    var reveal by remember {mutableStateOf(false)}
    var settings by remember {mutableStateOf(server == DEFAULT_SERVER_URL)}
    val entryColors=darkColorScheme(primary=EntryGreen,onPrimary=Color(0xFF071B0E),background=EntryBackground,surface=Color(0xFF121A15),onSurface=Color(0xFFF0F5F1),onSurfaceVariant=EntryMuted)
    MaterialTheme(colorScheme=entryColors) {
      Surface(color=EntryBackground,contentColor=entryColors.onSurface,modifier=Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xFF123324),EntryBackground),radius=1400f)).windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
            val availableWidth=maxWidth
            val wide=availableWidth>=720.dp
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=if(wide) 40.dp else 24.dp,vertical=22.dp)) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {Box(Modifier.size(38.dp).background(EntryGreen,CircleShape).padding(10.dp)){Canvas(Modifier.fillMaxSize()){repeat(5){i->val h=size.height*(if(i==2)1f else if(i%2==0).5f else .8f);val x=(i+.5f)*size.width/5;drawLine(EntryBackground,Offset(x,(size.height-h)/2),Offset(x,(size.height+h)/2),2.dp.toPx())}}};Text("Sidewave",fontSize=21.sp,fontWeight=FontWeight.Bold)}
                    if(availableWidth>=350.dp) Text("Your rhythm.",fontSize=10.sp,color=EntryMuted)
                }
                Spacer(Modifier.height(if(wide) 55.dp else 20.dp))
                val introduction: @Composable ()->Unit = {
                    if(wide) Column {Text("FIND YOUR SOUND.",color=EntryGreen,fontSize=10.sp,letterSpacing=2.sp);Spacer(Modifier.height(18.dp));Text("Your music.",fontSize=44.sp,fontWeight=FontWeight.ExtraBold,letterSpacing=(-2).sp);Text("Your rhythm.",fontSize=44.sp,fontWeight=FontWeight.ExtraBold,color=EntryGreen,letterSpacing=(-2).sp);MusicEntryArt(Modifier.fillMaxWidth().height(300.dp));EntryEqualizer(Modifier.width(100.dp).height(32.dp))}
                    else Row(Modifier.fillMaxWidth().height(142.dp),verticalAlignment=Alignment.CenterVertically) {Column(Modifier.weight(1f)) {Text("FIND YOUR SOUND.",color=EntryGreen,fontSize=8.sp,letterSpacing=1.sp);Spacer(Modifier.height(12.dp));Text("Your music.",fontSize=if(availableWidth<350.dp)24.sp else 28.sp,fontWeight=FontWeight.ExtraBold,letterSpacing=(-1).sp);Text("Your rhythm.",fontSize=if(availableWidth<350.dp)24.sp else 28.sp,fontWeight=FontWeight.ExtraBold,color=EntryGreen,letterSpacing=(-1).sp)};MusicEntryArt(Modifier.width(if(availableWidth<350.dp)100.dp else 135.dp).height(125.dp))}
                }
                val form: @Composable ()->Unit = {
                    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(18.dp)) {
                        Text(if(signup)"Make room for music." else "Welcome back.",fontSize=if(wide)38.sp else 32.sp,fontWeight=FontWeight.Bold,letterSpacing=(-1.5).sp,lineHeight=40.sp)
                        Text(if(signup)"Find your next favorite. Create your account." else "Pick up where you left off.",fontSize=12.sp,color=EntryMuted)
                        Row(Modifier.fillMaxWidth().background(Color.White.copy(alpha=.045f),RoundedCornerShape(14.dp)).padding(5.dp)) {listOf(false to "Sign in",true to "Sign up").forEach { (value,label)->val color by animateColorAsState(if(signup==value)Color(0xFF2A322D) else Color.Transparent,label="Account tab");TextButton(onClick={onMode(value);reveal=false},enabled=!busy,modifier=Modifier.weight(1f).heightIn(min=46.dp),shape=RoundedCornerShape(10.dp),colors=ButtonDefaults.textButtonColors(containerColor=color,contentColor=if(signup==value)Color.White else EntryMuted)){Text(label,fontWeight=FontWeight.SemiBold)}}}
                        val fields=OutlinedTextFieldDefaults.colors(focusedBorderColor=EntryGreen,unfocusedBorderColor=Color.White.copy(alpha=.2f),focusedContainerColor=Color(0xFF111A14),unfocusedContainerColor=Color(0xFF0E1511))
                        OutlinedTextField(username,onUsername,label={Text("Username")},singleLine=true,enabled=!busy,shape=RoundedCornerShape(11.dp),colors=fields,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Next),modifier=Modifier.fillMaxWidth())
                        OutlinedTextField(password,onPassword,label={Text("Password")},singleLine=true,enabled=!busy,shape=RoundedCornerShape(11.dp),colors=fields,visualTransformation=if(reveal)VisualTransformation.None else PasswordVisualTransformation(),trailingIcon={TextButton(onClick={reveal=!reveal}){Text(if(reveal)"Hide" else "Show",fontSize=10.sp)}},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password,imeAction=if(signup)ImeAction.Next else ImeAction.Done),keyboardActions=KeyboardActions(onDone={if(!busy&&!signup)onSubmit()}),modifier=Modifier.fillMaxWidth())
                        AnimatedVisibility(signup) {OutlinedTextField(confirm,onConfirm,label={Text("Confirm password")},singleLine=true,enabled=!busy,shape=RoundedCornerShape(11.dp),colors=fields,visualTransformation=if(reveal)VisualTransformation.None else PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password,imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={if(!busy)onSubmit()}),modifier=Modifier.fillMaxWidth())}
                        if(error.isNotBlank()) Text(error,color=MaterialTheme.colorScheme.error,fontSize=12.sp)
                        Button(onClick=onSubmit,enabled=!busy&&username.isNotBlank()&&password.isNotBlank(),shape=CircleShape,modifier=Modifier.fillMaxWidth().heightIn(min=54.dp)) {if(busy)CircularProgressIndicator(Modifier.size(20.dp),strokeWidth=2.dp) else {Text(if(signup)"Create account" else "Sign in",fontWeight=FontWeight.Bold);Spacer(Modifier.width(12.dp));Icon(Icons.AutoMirrored.Filled.ArrowForward,null)}}
                        TextButton(onClick={onMode(!signup);reveal=false},enabled=!busy,modifier=Modifier.align(Alignment.CenterHorizontally)){Text(if(signup)"Already have an account? Sign in" else "New here? Join us",fontSize=12.sp)}
                        HorizontalDivider(color=Color.White.copy(alpha=.07f))
                        TextButton(onClick={settings=!settings},modifier=Modifier.align(Alignment.CenterHorizontally)){Text("Connection settings",fontSize=11.sp,color=EntryMuted)}
                        AnimatedVisibility(settings) {OutlinedTextField(server,onServer,label={Text("Server address")},singleLine=true,modifier=Modifier.fillMaxWidth(),colors=fields)}
                        TextButton(onClick=onOffline,enabled=!busy,modifier=Modifier.align(Alignment.CenterHorizontally)){Text("Continue with downloaded music",fontSize=11.sp,color=EntryMuted)}
                    }
                }
                if(wide) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(48.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.weight(1f)){introduction()};Box(Modifier.weight(1f).widthIn(max=430.dp)){form()}}
                else {introduction();HorizontalDivider(color=Color.White.copy(alpha=.07f));Spacer(Modifier.height(24.dp));form()}
                Spacer(Modifier.height(35.dp));HorizontalDivider(color=Color.White.copy(alpha=.07f));Text("SIDEWAVE · SARGIN LABS",Modifier.fillMaxWidth().padding(vertical=22.dp),fontSize=9.sp,letterSpacing=2.sp,color=EntryMuted)
            }
        }
      }
    }
}
