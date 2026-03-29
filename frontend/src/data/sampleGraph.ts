import type { FGData } from '../types/graph'

const STYLE: Record<string, { bg: string; text: string }> = {
  PERSON:       { bg: '#1a1a1a', text: '#ffffff' },
  ORGANIZATION: { bg: '#404040', text: '#ffffff' },
  TECHNOLOGY:   { bg: '#525252', text: '#ffffff' },
  EVENT:        { bg: '#525252', text: '#ffffff' },
  LOCATION:     { bg: '#404040', text: '#ffffff' },
  CONCEPT:      { bg: '#a3a3a3', text: '#0a0a0a' },
  PRODUCT:      { bg: '#a3a3a3', text: '#0a0a0a' },
  OTHER:        { bg: '#d4d4d4', text: '#0a0a0a' },
}

function node(id: string, name: string, type: string, description?: string) {
  const s = STYLE[type] ?? STYLE.OTHER
  return {
    id, name, type,
    description,
    source_document: 'Sample',
    chunk_count: 1,
    color: s.bg,
    textColor: s.text,
    val: Math.max(4, name.length),
  }
}

function edge(
  id: string, source: string, target: string,
  type: string, description?: string, confidence = 0.95,
) {
  return {
    id, source, target, type,
    description,
    confidence,
    source_document: 'Sample',
    color: `rgba(0,0,0,${Math.max(0.06, confidence * 0.15)})`,
  }
}

export const SAMPLE_GRAPH: FGData = {
  nodes: [
    node('p1',  'Sam Altman',        'PERSON',       'CEO of OpenAI'),
    node('p2',  'Ilya Sutskever',    'PERSON',       'Co-founder of OpenAI, left to start SSI'),
    node('p3',  'Greg Brockman',     'PERSON',       'Co-founder and President of OpenAI'),
    node('p4',  'Demis Hassabis',    'PERSON',       'CEO of Google DeepMind'),
    node('p5',  'Yann LeCun',        'PERSON',       'Chief AI Scientist at Meta'),
    node('p6',  'Geoffrey Hinton',   'PERSON',       'Godfather of deep learning, left Google'),
    node('o1',  'OpenAI',            'ORGANIZATION', 'Leading AI safety and research company'),
    node('o2',  'Google DeepMind',   'ORGANIZATION', 'AI research lab owned by Alphabet'),
    node('o3',  'Meta AI',           'ORGANIZATION', 'AI research division of Meta Platforms'),
    node('o4',  'SSI',               'ORGANIZATION', 'Safe Superintelligence Inc, founded by Sutskever'),
    node('o5',  'Microsoft',         'ORGANIZATION', 'Strategic investor in OpenAI'),
    node('o6',  'Anthropic',         'ORGANIZATION', 'AI safety company founded by ex-OpenAI researchers'),
    node('t1',  'GPT-4',             'PRODUCT',      'Large multimodal language model by OpenAI'),
    node('t2',  'Gemini',            'PRODUCT',      'Multimodal AI model by Google DeepMind'),
    node('t3',  'Llama 3',           'PRODUCT',      'Open-weight LLM by Meta'),
    node('t4',  'Claude',            'PRODUCT',      'AI assistant by Anthropic'),
    node('c1',  'Transformer',       'TECHNOLOGY',   'Attention-based neural network architecture'),
    node('c2',  'RLHF',              'CONCEPT',      'Reinforcement Learning from Human Feedback'),
    node('c3',  'AI Safety',         'CONCEPT',      'Field focused on aligning AI systems with human values'),
    node('c4',  'Deep Learning',     'CONCEPT',      'Neural network-based machine learning'),
    node('e1',  'NeurIPS 2023',      'EVENT',        'Major AI research conference'),
    node('l1',  'San Francisco',     'LOCATION',     'Hub of AI industry in the US'),
  ],
  links: [
    edge('r1',  'p1', 'o1',  'CEO_OF',           'Sam Altman leads OpenAI'),
    edge('r2',  'p2', 'o1',  'CO_FOUNDED',       'Ilya co-founded OpenAI'),
    edge('r3',  'p3', 'o1',  'CO_FOUNDED',       'Greg co-founded OpenAI'),
    edge('r4',  'p2', 'o4',  'FOUNDED',          'Ilya left OpenAI to found SSI', 0.99),
    edge('r5',  'p4', 'o2',  'CEO_OF',           'Demis leads Google DeepMind'),
    edge('r6',  'p5', 'o3',  'CHIEF_SCIENTIST_AT', 'Yann is Chief AI Scientist at Meta'),
    edge('r7',  'o5', 'o1',  'INVESTED_IN',      'Microsoft invested $13B in OpenAI', 0.99),
    edge('r8',  'o1', 't1',  'DEVELOPED',        'OpenAI built GPT-4'),
    edge('r9',  'o2', 't2',  'DEVELOPED',        'Google DeepMind built Gemini'),
    edge('r10', 'o3', 't3',  'DEVELOPED',        'Meta AI released Llama 3 open-source'),
    edge('r11', 'o6', 't4',  'DEVELOPED',        'Anthropic built Claude'),
    edge('r12', 't1', 'c1',  'BASED_ON',         'GPT-4 uses the Transformer architecture'),
    edge('r13', 't2', 'c1',  'BASED_ON',         'Gemini uses the Transformer architecture'),
    edge('r14', 't1', 'c2',  'TRAINED_WITH',     'GPT-4 used RLHF for alignment'),
    edge('r15', 't4', 'c2',  'TRAINED_WITH',     'Claude used Constitutional AI + RLHF'),
    edge('r16', 'c2', 'c3',  'PART_OF',          'RLHF is a core technique in AI safety', 0.85),
    edge('r17', 'p6', 'c4',  'PIONEERED',        'Hinton pioneered deep learning'),
    edge('r18', 'c4', 'c1',  'GAVE_RISE_TO',     'Deep learning advances led to Transformers'),
    edge('r19', 'p6', 'c3',  'ADVOCATES_FOR',    'Hinton is now vocal about AI safety risks', 0.9),
    edge('r20', 'o1', 'c3',  'PRIORITIZES',      'OpenAI mission centers on safe AGI'),
    edge('r21', 'o6', 'c3',  'FOUNDED_AROUND',   'Anthropic was founded with AI safety focus'),
    edge('r22', 'p1', 'l1',  'BASED_IN',         'Sam Altman works in San Francisco'),
    edge('r23', 'o1', 'l1',  'HEADQUARTERED_IN', 'OpenAI is headquartered in SF'),
    edge('r24', 'p2', 'e1',  'PRESENTED_AT',     'Ilya presented research at NeurIPS 2023', 0.8),
    edge('r25', 'o2', 'o1',  'COMPETES_WITH',    'DeepMind and OpenAI are rivals', 0.95),
    edge('r26', 'o3', 'o1',  'COMPETES_WITH',    'Meta AI and OpenAI are rivals', 0.9),
  ],
}
