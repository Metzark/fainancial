import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai/client";
import { NextResponse } from "next/server";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.json({ error: "Unauthorized", success: false }, { status: 401 });
  }

  if (error) {
    return NextResponse.json({ error: "Unknown error", success: false }, { status: 500 });
  }

  const { message, advisor_id } = await req.json();

  if (!message || !advisor_id) {
    return NextResponse.json({ error: "Message and advisor_id are required", success: false }, { status: 400 });
  }

  const { error: messageError } = await supabase.from("messages").insert({
    advisor_id: advisor_id,
    user_id: data.user.id,
    message: message,
    from_user: true,
  });

  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }

  // Get last 5 messages for this user and advisor
  const { data: previousMessages, error: historyError } = await supabase
    .from("messages")
    .select("*")
    .eq("user_id", data.user.id)
    .eq("advisor_id", advisor_id)
    .order("created_at", { ascending: true })
    .limit(9);

  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }
  // Add system message to describe advisor's persona
  const { data: advisor } = await supabase.from("advisors").select("*").eq("id", advisor_id).single();

  if (!advisor) {
    return NextResponse.json({ error: "Advisor not found" }, { status: 404 });
  }

  const systemMessage: ChatCompletionMessageParam = {
    role: "system",
    content: `You are ${advisor.name}, a financial advisor. ${advisor.persona} Keep your responses concise (less than 50 words) and to the point.`,
  };

  const messages: ChatCompletionMessageParam[] = [systemMessage];

  previousMessages.forEach((message) => {
    messages.push({
      role: message.from_user ? "user" : "assistant",
      content: message.message,
    });
  });

  const completion = await openai.chat.completions.create({
    messages: messages,
    model: "gpt-4o-mini",
  });

  const assistantMessage = completion.choices[0].message.content;

  const { error: assistantMessageError } = await supabase.from("messages").insert({
    advisor_id: advisor_id,
    user_id: data.user.id,
    message: assistantMessage,
    from_user: false,
  });

  if (assistantMessageError) {
    return NextResponse.json({ error: assistantMessageError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
  });
}
